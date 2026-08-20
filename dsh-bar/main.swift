// dsh-bar — 顶部菜单栏小鲸鱼：一键启停 dsh web，右键菜单含状态/启停/打开页面/日志/开机自启/设置。
//
// 要点：
//   · LSUIElement（不进程序坞，只在系统状态栏显示鲸鱼图标）
//   · 直接用 Process 把 `dsh web --no-open` 作为子进程拉起，PID 即 dsh 进程，
//     停止时发 SIGINT（= Ctrl+C 优雅关服），逐级 SIGTERM/SIGKILL 兜底。
//   · PATH/端口/日志路径可配置，配置存 ~/Library/Application Support/dsh-bar/config.json。

import AppKit
import Foundation
import Darwin

// MARK: - 配置

struct Config: Codable {
    var port: Int = 3080
    var dshPath: String = ""          // 空 = ~/.local/bin/dsh
    var nodePath: String = ""         // 空 = 自动检测（nvm 最新 / homebrew / usr-local）
    var logFile: String = "/tmp/dsh-web.log"
    var autoOpenBrowser: Bool = true
    var stopServiceOnQuit: Bool = true     // 退出 dsh-bar 时停掉 DSH 服务（默认停）
    var autoStartServiceOnLogin: Bool = false

    enum CodingKeys: String, CodingKey {
        case port, dshPath, nodePath, logFile, autoOpenBrowser
        case stopServiceOnQuit, autoStartServiceOnLogin
        case oldKeepServiceOnQuit = "keepServiceOnQuit"
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        port = try c.decodeIfPresent(Int.self, forKey: .port) ?? 3080
        dshPath = try c.decodeIfPresent(String.self, forKey: .dshPath) ?? ""
        nodePath = try c.decodeIfPresent(String.self, forKey: .nodePath) ?? ""
        logFile = try c.decodeIfPresent(String.self, forKey: .logFile) ?? "/tmp/dsh-web.log"
        autoOpenBrowser = try c.decodeIfPresent(Bool.self, forKey: .autoOpenBrowser) ?? true
        if let v = try c.decodeIfPresent(Bool.self, forKey: .stopServiceOnQuit) {
            stopServiceOnQuit = v
        } else if let old = try c.decodeIfPresent(Bool.self, forKey: .oldKeepServiceOnQuit) {
            stopServiceOnQuit = !old     // 旧 key：true=退出时不停止
        } else {
            stopServiceOnQuit = true
        }
        autoStartServiceOnLogin = try c.decodeIfPresent(Bool.self, forKey: .autoStartServiceOnLogin) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(port, forKey: .port)
        try c.encode(dshPath, forKey: .dshPath)
        try c.encode(nodePath, forKey: .nodePath)
        try c.encode(logFile, forKey: .logFile)
        try c.encode(autoOpenBrowser, forKey: .autoOpenBrowser)
        try c.encode(stopServiceOnQuit, forKey: .stopServiceOnQuit)
        try c.encode(autoStartServiceOnLogin, forKey: .autoStartServiceOnLogin)
    }
}

// MARK: - 主代理

final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem?
    private var serviceProcess: Process?
    private var stopping = false
    private var userRequestedStop = false
    private var didAutoOpen = false
    private var isQuitting = false
    private var refreshTimer: Timer?
    private var lastMenuKey = ""

    private var config = Config()
    private var settingsWindow: NSWindow?

    private let bundleId = "ai.deepseek.dsh-bar"

    private var home: String { NSHomeDirectory() }
    private var configDir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("dsh-bar", isDirectory: true)
    }
    private var configURL: URL { configDir.appendingPathComponent("config.json") }
    private var launchAgentURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(bundleId).plist")
    }
    private var logURL: URL { URL(fileURLWithPath: config.logFile) }
    private func webURL() -> URL { URL(string: "http://127.0.0.1:\(config.port)/")! }

    // MARK: - 生命周期

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        loadConfig()
        installStatusItem()
        rebuildMenu()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.refresh()
        }
        if CommandLine.arguments.contains("--autolaunch"), config.autoStartServiceOnLogin {
            startService()
        } else {
            refresh()
        }

        // 诊断：--debug-settings 会短暂打开设置窗口并打印布局尺寸后退出
        if CommandLine.arguments.contains("--debug-settings") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self = self else { return }
                self.openSettings()
                self.settingsWindow?.contentView?.layoutSubtreeIfNeeded()
                if let w = self.settingsWindow, let cv = w.contentView {
                    print("DEBUG settings window frame=\(w.frame) contentFitting=\(cv.fittingSize) contentFrame=\(cv.frame)")
                    if let rep = cv.bitmapImageRepForCachingDisplay(in: cv.bounds) {
                        cv.cacheDisplay(in: cv.bounds, to: rep)
                        if let data = rep.representation(using: .png, properties: [:]) {
                            try? data.write(to: URL(fileURLWithPath: "/tmp/dsh-bar-settings.png"))
                            print("DEBUG snapshot -> /tmp/dsh-bar-settings.png")
                        }
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    NSApp.terminate(nil)
                }
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        refreshTimer?.invalidate()
        isQuitting = true
        if config.stopServiceOnQuit, let proc = serviceProcess, proc.isRunning {
            notify("正在停止 DSH 服务…")
            stopPID(proc.processIdentifier)   // 同步强制停服（SIGINT→SIGTERM→SIGKILL 阶梯，阻塞至退出）
        }
    }

    // MARK: - 状态栏

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let path = Bundle.main.path(forResource: "whale-36", ofType: "png") {
            let img = NSImage(contentsOfFile: path)
            img?.isTemplate = true
            img?.size = NSSize(width: 18, height: 18)
            item.button?.image = img
        } else {
            item.button?.title = "🐳"
        }
        item.button?.toolTip = "dsh（DeepSeek Harness 菜单栏）"
        statusItem = item
    }

    // MARK: - 菜单

    private func add(title: String, action: Selector, to menu: NSMenu) {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: "")
        it.target = self
        menu.addItem(it)
    }

    /// 纯信息（置灰）菜单项。
    private func infoItem(_ title: String) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        it.isEnabled = false
        return it
    }

    private func statusText() -> String {
        if let p = serviceProcess, p.isRunning { return "DSH 服务：运行中（PID \(p.processIdentifier)）" }
        if stopping { return "DSH 服务：停止中…" }
        if portUp(port: config.port) { return "端口 \(config.port) 被外部进程占用" }
        return "DSH 服务：已停止"
    }

    private func rebuildMenu() {
        let m = NSMenu()
        let state = NSMenuItem(title: statusText(), action: nil, keyEquivalent: "")
        state.isEnabled = false
        m.addItem(state)
        // dsh 路径信息行：便于确认当前生效/自动检测到的是哪个 dsh
        if let dsh = resolvedDshPath() {
            m.addItem(infoItem("dsh 路径：\(dsh.path)"))
        } else {
            m.addItem(infoItem("dsh 路径：未找到（请打开设置选择文件）"))
        }
        m.addItem(.separator())

        if let p = serviceProcess, p.isRunning {
            add(title: "停止 DSH 服务", action: #selector(stopAction(_:)), to: m)
        } else {
            add(title: "启动 DSH 服务", action: #selector(startAction(_:)), to: m)
            if portUp(port: config.port) {
                // 端口被外部进程占用时的兜底强杀
                add(title: "强制停止 \(config.port) 端口服务", action: #selector(forceStopAction(_:)), to: m)
            }
        }
        m.addItem(.separator())

        add(title: "打开 Web 页面", action: #selector(openPageAction(_:)), to: m)
        add(title: "查看日志", action: #selector(openLogAction(_:)), to: m)
        m.addItem(.separator())

        let auto = NSMenuItem(title: "开机自启（登录时显示 dsh-bar）", action: #selector(toggleAutostartAction(_:)), keyEquivalent: "")
        auto.target = self
        auto.state = autostartEnabled() ? .on : .off
        m.addItem(auto)

        m.addItem(.separator())
        add(title: "设置…", action: #selector(settingsAction(_:)), to: m)
        m.addItem(.separator())
        add(title: "退出 dsh-bar", action: #selector(quitAction(_:)), to: m)

        statusItem?.menu = m
    }

    private func menuKey() -> String {
        let hasProc = (serviceProcess?.isRunning ?? false)
        return statusText() + "|\(hasProc ? 1 : 0)|\(autostartEnabled() ? 1 : 0)|\(stopping ? 1 : 0)"
    }

    private func refresh() {
        // 子进程意外退出 -> 清状态
        if let p = serviceProcess, !p.isRunning, !stopping {
            serviceProcess = nil
        }
        // 启动后端口就绪 -> 自动打开浏览器（一次）
        if let p = serviceProcess, p.isRunning, config.autoOpenBrowser, !didAutoOpen, portUp(port: config.port) {
            didAutoOpen = true
            openPage()
        }
        let key = menuKey()
        if key != lastMenuKey {
            lastMenuKey = key
            rebuildMenu()
        }
    }

    // MARK: - 服务启停

    /// 解析 dsh 路径：显式配置 → 标准默认 ~/.local/bin/dsh → 自动探测（PATH / homebrew / usr-local）。
    private func resolvedDshPath() -> URL? {
        let cfg = config.dshPath.trimmingCharacters(in: .whitespaces)
        var c: [String] = []
        if !cfg.isEmpty { c.append(cfg) }
        c.append("\(home)/.local/bin/dsh")
        c += autoDshCandidates()
        return firstExisting(c)
    }

    /// 纯自动探测（设置界面“留空 = 自动检测”预览用，不含已保存的显式配置）。
    private func autoDetectedDshPath() -> URL? {
        firstExisting(["\(home)/.local/bin/dsh"] + autoDshCandidates())
    }

    private func firstExisting(_ paths: [String]) -> URL? {
        for p in paths {
            let e = (p as NSString).expandingTildeInPath
            if FileManager.default.fileExists(atPath: e) { return URL(fileURLWithPath: e) }
        }
        return nil
    }

    /// 自动探测候选：PATH ＋ 常见安装目录 ＋ nvm 各 node 版本的全局 bin。
    private func autoDshCandidates() -> [String] {
        var c: [String] = []
        if let w = whichInPath("dsh") { c.append(w) }
        c += ["/opt/homebrew/bin/dsh", "/usr/local/bin/dsh", "/usr/bin/dsh"]
        c += nvmDshCandidates()
        return c
    }

    /// 在 PATH 中查找命令（sh -c 'command -v …'，并补上 GUI 环境默认缺的目录）。
    private func whichInPath(_ name: String) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "command -v \(name) 2>/dev/null || command -v \(name).cmd 2>/dev/null"]
        var env = ProcessInfo.processInfo.environment
        let extra = "\(home)/.local/bin:\(home)/bin:\(home)/.npm-global/bin:\(home)/.npm/bin:\(home)/.node/bin:/opt/homebrew/bin:/usr/local/bin"
        env["PATH"] = [extra, env["PATH"]].compactMap { $0 }.joined(separator: ":")
        p.environment = env
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do {
            try p.run()
            p.waitUntilExit()
            let s = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return (s?.isEmpty ?? true) ? nil : s
        } catch {
            return nil
        }
    }

    /// 按版本号降序返回 nvm 已安装的 node 版本目录（默认 ~/.nvm，支持 NVM_DIR）。
    private func nvmVersionsDescending() -> [String] {
        var roots = ["\(home)/.nvm"]
        if let nd = ProcessInfo.processInfo.environment["NVM_DIR"], !nd.isEmpty {
            let expanded = (nd as NSString).expandingTildeInPath
            if expanded != roots[0] { roots.append(expanded) }
        }
        var out: [String] = []
        for r in roots {
            let dir = r + "/versions/node"
            guard let vers = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
            func ints(_ v: String) -> [Int] { String(v.dropFirst()).split(separator: ".").compactMap { Int($0) } }
            func newer(_ a: String, _ b: String) -> Bool {  // 版本号降序
                let x = ints(a), y = ints(b)
                for i in 0..<max(x.count, y.count) {
                    let l = i < x.count ? x[i] : 0
                    let r = i < y.count ? y[i] : 0
                    if l != r { return l > r }
                }
                return false
            }
            out += vers.filter { $0.hasPrefix("v") }.sorted(by: newer).map { dir + "/" + $0 }
        }
        return out
    }

    /// nvm 各 node 版本全局 bin 里的 dsh（`npm i -g @deepseek-ai/dsh` 且用 nvm 装 node 的场景）。
    private func nvmDshCandidates() -> [String] {
        nvmVersionsDescending().map { $0 + "/bin/dsh" }
    }

    private func nvmNode() -> URL? {
        for v in nvmVersionsDescending() {
            let p = v + "/bin/node"
            if FileManager.default.isExecutableFile(atPath: p) { return URL(fileURLWithPath: p) }
        }
        return nil
    }

    private func resolvedNodePath() -> URL? {
        if !config.nodePath.isEmpty, FileManager.default.fileExists(atPath: config.nodePath) {
            return URL(fileURLWithPath: config.nodePath)
        }
        if let n = nvmNode() { return n }
        for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
            if FileManager.default.isExecutableFile(atPath: c) { return URL(fileURLWithPath: c) }
        }
        return nil
    }

    private func childEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let dshDir = resolvedDshPath()?.deletingLastPathComponent().path ?? "\(home)/.local/bin"
        let nodeDir = resolvedNodePath()?.deletingLastPathComponent().path ?? ""
        let extra = nodeDir.isEmpty ? dshDir : "\(dshDir):\(nodeDir)"
        env["PATH"] = "\(extra):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        env["HOME"] = home
        return env
    }

    private func startService() {
        guard serviceProcess == nil, !stopping else { return }
        guard let dsh = resolvedDshPath() else {
            notify("找不到 dsh 可执行文件（设置→服务 可点「自动检测」或「浏览…」指定）")
            return
        }
        guard let node = resolvedNodePath() else {
            notify("找不到 node 可执行文件（可在设置中手动填写）")
            return
        }
        if portUp(port: config.port) {
            notify("端口 \(config.port) 已被占用，可能已有 DSH 在运行，未重复启动")
            refresh(); return
        }

        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }

        didAutoOpen = false
        userRequestedStop = false
        stopping = false

        let p = Process()
        p.executableURL = node
        var args = [dsh.path, "web", "--no-open"]
        if config.port != 3080 { args += ["--port", String(config.port)] }
        p.arguments = args
        p.environment = childEnvironment()
        if let fh = try? FileHandle(forWritingTo: logURL) {
            p.standardOutput = fh
            p.standardError = fh
        }
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let wasManaging = self.serviceProcess != nil
                let unexpected = wasManaging && !self.userRequestedStop && !self.isQuitting
                self.serviceProcess = nil
                self.stopping = false
                if unexpected { self.notify("DSH 服务意外退出，日志：\(self.config.logFile)") }
                self.refresh()
            }
        }

        do {
            try p.run()
            serviceProcess = p
            notify("DSH 服务启动中（端口 \(config.port)）…")
        } catch {
            notify("启动失败：\(error.localizedDescription)")
        }
        refresh()
    }

    private func stopService() {
        guard let proc = serviceProcess else {
            stopping = false
            refresh(); return
        }
        guard proc.isRunning else {
            serviceProcess = nil
            refresh(); return
        }
        userRequestedStop = true
        stopping = true
        notify("正在停止 DSH 服务…")
        refresh()

        let pid = proc.processIdentifier
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.stopPID(pid)                 // SIGINT → SIGTERM → SIGKILL 阶梯，阻塞直至退出
            Thread.sleep(forTimeInterval: 0.3)
            DispatchQueue.main.async {
                self?.stopping = false
                self?.serviceProcess = nil     // terminationHandler 兜底，这里再清一次
                self?.notify("DSH 服务已停止")
                self?.refresh()
            }
        }
    }

    // MARK: - 进程停止工具（可靠杀掉单个 PID：SIGINT → SIGTERM → SIGKILL）

    private func isProcessAlive(_ pid: Int32) -> Bool {
        guard pid > 1 else { return false }
        let k = Process()
        k.executableURL = URL(fileURLWithPath: "/bin/kill")
        k.arguments = ["-0", String(pid)]
        do {
            try k.run(); k.waitUntilExit()
            return k.terminationStatus == 0
        } catch { return false }
    }

    /// 对一个 PID 依次发 SIGINT / SIGTERM / SIGKILL，直到进程退出（同步阻塞，最多约 5 秒）。
    private func stopPID(_ pid: Int32) {
        guard isProcessAlive(pid) else { return }
        func signal(_ sig: String) {
            let k = Process()
            k.executableURL = URL(fileURLWithPath: "/bin/kill")
            k.arguments = [sig, String(pid)]
            try? k.run()
            k.waitUntilExit()
        }
        signal("-INT")                            // Ctrl+C 优雅关服
        var waited = 0.0
        while isProcessAlive(pid) && waited < 2.0 { Thread.sleep(forTimeInterval: 0.1); waited += 0.1 }
        if isProcessAlive(pid) {
            signal("-TERM")
            waited = 0.0
            while isProcessAlive(pid) && waited < 2.0 { Thread.sleep(forTimeInterval: 0.1); waited += 0.1 }
        }
        if isProcessAlive(pid) { signal("-9") }   // 最后手段
    }

    // MARK: - 强制停止端口服务（兜底）

    private func portPIDs(_ port: Int) -> [Int32] {
        guard let out = runShell("/usr/sbin/lsof -nP -iTCP:\(port) -sTCP:LISTEN -t") else { return [] }
        return out.split(separator: "\n").compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
    }

    @objc private func forceStopAction(_ sender: Any?) {
        let pids = portPIDs(config.port)
        guard !pids.isEmpty else {
            notify("端口 \(config.port) 当前没有占用进程")
            refresh(); return
        }
        notify("正在强制停止端口 \(config.port) 上的 \(pids.count) 个进程…")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            for p in pids { self?.stopPID(p) }
            DispatchQueue.main.async { [weak self] in
                self?.notify("已处理端口 \(self?.config.port ?? 0) 的占用进程")
                self?.refresh()
            }
        }
    }

    // MARK: - 动作

    @objc private func startAction(_ sender: Any?) { startService() }
    @objc private func stopAction(_ sender: Any?) { stopService() }

    @objc private func openPageAction(_ sender: Any?) { openPage() }
    private func openPage() {
        NSWorkspace.shared.open(webURL())   // 未就绪也打开，让浏览器自己刷新
    }

    @objc private func openLogAction(_ sender: Any?) {
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        NSWorkspace.shared.open(logURL)
    }

    @objc private func quitAction(_ sender: Any?) {
        NSApp.terminate(nil)
    }

    // MARK: - 开机自启（LaunchAgent）

    private func autostartEnabled() -> Bool {
        FileManager.default.fileExists(atPath: launchAgentURL.path)
    }

    @objc private func toggleAutostartAction(_ sender: Any?) {
        if autostartEnabled() { disableAutostart() } else { enableAutostart() }
        refresh()
    }

    private func enableAutostart() {
        let plist: [String: Any] = [
            "Label": bundleId,
            "ProgramArguments": [Bundle.main.executablePath ?? "", "--autolaunch"],
            "RunAtLoad": true,
            "ProcessType": "Interactive",
        ]
        do {
            try FileManager.default.createDirectory(at: launchAgentURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try data.write(to: launchAgentURL, options: .atomic)
            _ = runShell("/bin/launchctl bootstrap gui/\(getuid()) \(launchAgentURL.path)")
            notify("已开启开机自启（登录时自动运行 dsh-bar）")
        } catch {
            notify("开启开机自启失败：\(error.localizedDescription)")
        }
    }

    private func disableAutostart() {
        _ = runShell("/bin/launchctl bootout gui/\(getuid()) \(launchAgentURL.path)")
        try? FileManager.default.removeItem(at: launchAgentURL)
        notify("已关闭开机自启")
    }

    // MARK: - 设置窗口

    @objc private func settingsAction(_ sender: Any?) {
        openSettings()
    }

    // 设置窗口控件引用（供“恢复默认”即时重置 UI）
    private weak var settingsPortField: NSTextField?
    private weak var settingsDshField: NSTextField?
    private weak var settingsNodeField: NSTextField?
    private weak var settingsLogField: NSTextField?
    private weak var settingsDshStatusLabel: NSTextField?
    private weak var settingsAutoOpenCheck: NSButton?
    private weak var settingsStopOnQuitCheck: NSButton?
    private weak var settingsStartOnLoginCheck: NSButton?

    /// 圆角输入框。
    private func makeField(_ value: String, placeholder: String) -> NSTextField {
        let f = NSTextField(string: value)
        f.placeholderString = placeholder
        f.bezelStyle = .roundedBezel
        f.font = .systemFont(ofSize: 13)
        f.maximumNumberOfLines = 1
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        f.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
        return f
    }

    /// 一行（左侧标签 + 可拉伸输入框）。
    private func makeRow(_ title: String, field: NSTextField) -> NSStackView {
        let l = NSTextField(labelWithString: title)
        l.font = .systemFont(ofSize: 13)
        l.textColor = .secondaryLabelColor
        l.alignment = .right
        l.setContentHuggingPriority(.required, for: .horizontal)
        l.widthAnchor.constraint(equalToConstant: 64).isActive = true
        let s = NSStackView(views: [l, field])
        s.orientation = .horizontal
        s.spacing = 8
        s.alignment = .centerY
        return s
    }

    /// 带标题的分组卡片（普通 NSView + 约束，能让父堆栈正确测量内容高度）。
    private func makeCard(title: String, content: NSView) -> NSView {
        let card = NSView()
        card.wantsLayer = true
        card.layer?.cornerRadius = 10
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        card.layer?.borderWidth = 1.0
        card.layer?.borderColor = NSColor.separatorColor.cgColor

        let t = NSTextField(labelWithString: title)
        t.font = .systemFont(ofSize: 12, weight: .semibold)
        t.textColor = .tertiaryLabelColor

        let v = NSStackView(views: [t, content])
        v.orientation = .vertical
        v.alignment = .width
        v.spacing = 10
        v.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(v)
        NSLayoutConstraint.activate([
            v.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            v.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            v.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            v.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -10),
        ])
        return card
    }

    private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)
        if let win = settingsWindow {
            win.makeKeyAndOrderFront(nil)
            return
        }

        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 0),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        win.title = "dsh 设置"
        win.isReleasedWhenClosed = false

        // ---- 表单控件 ----
        let portField = makeField(String(config.port), placeholder: "默认 3080")
        portField.widthAnchor.constraint(greaterThanOrEqualToConstant: 210).isActive = true
        let dshField = makeField(config.dshPath, placeholder: "留空 = 自动检测")
        dshField.widthAnchor.constraint(greaterThanOrEqualToConstant: 200).isActive = true
        dshField.target = self
        dshField.action = #selector(dshFieldEdited(_:))
        let dshDetect = NSButton(title: "自动检测", target: self, action: #selector(detectDshAction(_:)))
        dshDetect.bezelStyle = .rounded
        dshDetect.font = .systemFont(ofSize: 12)
        let dshBrowse = NSButton(title: "浏览…", target: self, action: #selector(browseDshAction(_:)))
        dshBrowse.bezelStyle = .rounded
        dshBrowse.font = .systemFont(ofSize: 12)
        let dshStatus = NSTextField(labelWithString: "")
        dshStatus.font = .systemFont(ofSize: 11)
        dshStatus.lineBreakMode = .byTruncatingMiddle
        dshStatus.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let nodeField = makeField(config.nodePath, placeholder: "自动检测（nvm / homebrew）")
        let logField = makeField(config.logFile, placeholder: "日志文件路径")

        let autoOpen = NSButton(checkboxWithTitle: "启动后自动打开浏览器", target: nil, action: nil)
        autoOpen.state = config.autoOpenBrowser ? .on : .off
        let stopOnQuit = NSButton(checkboxWithTitle: "退出 dsh-bar 时停止 DSH 服务", target: nil, action: nil)
        stopOnQuit.state = config.stopServiceOnQuit ? .on : .off
        let startOnLogin = NSButton(checkboxWithTitle: "登录后自动启动 DSH 服务", target: nil, action: nil)
        startOnLogin.state = config.autoStartServiceOnLogin ? .on : .off
        for cb in [autoOpen, stopOnQuit, startOnLogin] {
            cb.setContentHuggingPriority(.required, for: .horizontal)
        }

        // 记住引用，供“恢复默认” / 路径状态刷新使用
        settingsPortField = portField; settingsDshField = dshField
        settingsDshStatusLabel = dshStatus
        settingsNodeField = nodeField; settingsLogField = logField
        settingsAutoOpenCheck = autoOpen; settingsStopOnQuitCheck = stopOnQuit
        settingsStartOnLoginCheck = startOnLogin

        // ---- 头部：鲸鱼 + 标题 ----
        let icon = NSImageView()
        if let p = Bundle.main.path(forResource: "whale-36", ofType: "png") {
            let img = NSImage(contentsOfFile: p)
            img?.isTemplate = true
            icon.image = img
        }
        icon.contentTintColor = .labelColor
        icon.imageScaling = .scaleProportionallyDown
        icon.widthAnchor.constraint(equalToConstant: 36).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 36).isActive = true

        let headTitle = NSTextField(labelWithString: "dsh 设置")
        headTitle.font = .systemFont(ofSize: 16, weight: .bold)
        let headSub = NSTextField(labelWithString: "DeepSeek Harness · 顶部菜单栏启停工具")
        headSub.font = .systemFont(ofSize: 12)
        headSub.textColor = .secondaryLabelColor
        let headText = NSStackView(views: [headTitle, headSub])
        headText.orientation = .vertical
        headText.alignment = .leading
        headText.spacing = 2

        let head = NSStackView(views: [icon, headText])
        head.orientation = .horizontal
        head.alignment = .centerY
        head.spacing = 10

        // ---- 卡片一：服务 ----
        // dsh 路径行：标签 + 输入框 + 自动检测 + 浏览
        let dshLabel = NSTextField(labelWithString: "dsh 路径")
        dshLabel.font = .systemFont(ofSize: 13)
        dshLabel.textColor = .secondaryLabelColor
        dshLabel.alignment = .right
        dshLabel.setContentHuggingPriority(.required, for: .horizontal)
        dshLabel.widthAnchor.constraint(equalToConstant: 64).isActive = true
        let dshRow = NSStackView(views: [dshLabel, dshField, dshDetect, dshBrowse])
        dshRow.orientation = .horizontal
        dshRow.spacing = 8
        dshRow.alignment = .centerY

        // dsh 状态行（缩进与输入框对齐，显示当前生效路径）
        let indent = NSView()
        indent.widthAnchor.constraint(equalToConstant: 72).isActive = true
        let dshStatusRow = NSStackView(views: [indent, dshStatus])
        dshStatusRow.orientation = .horizontal
        dshStatusRow.alignment = .leading

        let serviceRows = NSStackView(views: [
            makeRow("端口", field: portField),
            dshRow,
            dshStatusRow,
            makeRow("node 路径", field: nodeField),
            makeRow("日志文件", field: logField),
        ])
        serviceRows.orientation = .vertical
        serviceRows.alignment = .width
        serviceRows.spacing = 10
        let cardService = makeCard(title: "服务", content: serviceRows)

        // ---- 卡片二：行为 ----
        let checks = NSStackView(views: [autoOpen, stopOnQuit, startOnLogin])
        checks.orientation = .vertical
        checks.alignment = .leading
        checks.spacing = 8
        let cardBehavior = makeCard(title: "行为", content: checks)

        // ---- 底部按钮 ----
        let restoreBtn = NSButton(title: "恢复默认", target: self, action: #selector(restoreDefaults(_:)))
        restoreBtn.bezelStyle = .inline
        let saveBtn = NSButton(title: "保存", target: self, action: #selector(saveButtonClicked(_:)))
        saveBtn.bezelStyle = .rounded
        saveBtn.keyEquivalent = "\r"
        let cancelBtn = NSButton(title: "取消", target: self, action: #selector(cancelSettings(_:)))
        cancelBtn.bezelStyle = .rounded

        let spacer = NSView()
        spacer.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .horizontal)
        spacer.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(1), for: .horizontal)
        let buttons = NSStackView(views: [restoreBtn, spacer, cancelBtn, saveBtn])
        buttons.orientation = .horizontal
        buttons.spacing = 8

        // ---- 页脚：配置文件位置 ----
        let footer = NSTextField(labelWithString: "配置：\(configURL.path)")
        footer.font = .systemFont(ofSize: 11)
        footer.textColor = .tertiaryLabelColor
        footer.lineBreakMode = .byTruncatingMiddle

        // ---- 根堆栈（20pt 左右边距，避免贴边） ----
        let root = NSStackView(views: [head, cardService, cardBehavior, footer, buttons])
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 14
        root.edgeInsets = NSEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
        // NSStackView 的 .width 对齐在固定宽度窗口里并不会让所有子视图等宽铺满，
        // 这里显式把每个子视图宽度钉到根宽（减去左右边距），保证两张卡片等宽对齐。
        for v in root.arrangedSubviews {
            v.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -40).isActive = true
        }

        let wrap = NSView()
        wrap.addSubview(root)
        root.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: wrap.topAnchor),
            root.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
            root.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
        ])
        win.contentView = wrap

        // ---- 保存逻辑（clousre 转发） ----
        let onSave = { [weak self] in
            guard let self = self else { return }
            self.config.port = Int(portField.stringValue) ?? self.config.port
            let d = dshField.stringValue.trimmingCharacters(in: .whitespaces)
            self.config.dshPath = d == dshField.placeholderString ? "" : d
            let n = nodeField.stringValue.trimmingCharacters(in: .whitespaces)
            self.config.nodePath = n == nodeField.placeholderString ? "" : n
            self.config.logFile = logField.stringValue.isEmpty ? "/tmp/dsh-web.log" : logField.stringValue
            self.config.autoOpenBrowser = autoOpen.state == .on
            self.config.stopServiceOnQuit = stopOnQuit.state == .on
            self.config.autoStartServiceOnLogin = startOnLogin.state == .on
            self.saveConfig()
            self.settingsWindow?.orderOut(nil)
            self.notify("设置已保存（重启服务后生效）")
            self.refresh()
        }
        saveClosure = onSave

        win.contentView = wrap
        win.layoutIfNeeded()
        let fit = root.fittingSize
        win.setContentSize(NSSize(width: max(560.0, fit.width), height: fit.height + 8))
        win.layoutIfNeeded()
        win.center()

        settingsWindow = win
        updateDshStatus()
        win.makeKeyAndOrderFront(nil)
    }

    private var saveClosure: (() -> Void)?

    @objc private func saveButtonClicked(_ sender: Any?) { saveClosure?() }
    @objc private func cancelSettings(_ sender: Any?) { settingsWindow?.orderOut(nil) }

    // MARK: - 设置：dsh 路径辅助（自动检测 / 浏览 / 状态）

    @objc private func dshFieldEdited(_ sender: Any?) { updateDshStatus() }

    /// 自动检测并回填到输入框（保存后即为显式路径，后续运行更稳定）。
    @objc private func detectDshAction(_ sender: Any?) {
        guard let field = settingsDshField else { return }
        if let url = autoDetectedDshPath() {
            field.stringValue = url.path
        } else {
            field.stringValue = ""
            notify("未找到 dsh，请确认已安装 DeepSeek Harness 后重试")
        }
        updateDshStatus()
    }

    /// 文件选择器：手动挑选 dsh 可执行文件。
    @objc private func browseDshAction(_ sender: Any?) {
        guard let window = settingsWindow, let field = settingsDshField else { return }
        let panel = NSOpenPanel()
        panel.title = "选择 dsh 可执行文件"
        panel.message = "选择 dsh 命令对应的文件（通常为 ~/.local/bin/dsh）"
        panel.prompt = "选择"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if !field.stringValue.isEmpty {
            let dir = URL(fileURLWithPath: (field.stringValue as NSString).expandingTildeInPath)
                .deletingLastPathComponent()
            if FileManager.default.fileExists(atPath: dir.path) { panel.directoryURL = dir }
        }
        panel.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .OK, let url = panel.url, let self = self else { return }
            self.settingsDshField?.stringValue = url.path
            self.updateDshStatus()
        }
    }

    /// 根据当前输入框内容刷新 dsh 状态行（留空=自动检测，非空校验存在性）。
    private func updateDshStatus() {
        guard let field = settingsDshField, let label = settingsDshStatusLabel else { return }
        let typed = field.stringValue.trimmingCharacters(in: .whitespaces)
        var text: String
        var color: NSColor
        if typed.isEmpty {
            if let url = autoDetectedDshPath() {
                text = "当前生效：\(url.path)（自动检测）"
                color = .labelColor
            } else {
                text = "未找到 dsh——启动服务将失败，请点「自动检测」或「浏览…」"
                color = .systemRed
            }
        } else {
            let e = (typed as NSString).expandingTildeInPath
            if FileManager.default.fileExists(atPath: e) {
                text = "当前生效：\(e)（手动设置）"
                color = .labelColor
            } else {
                text = "路径不存在：\(e)"
                color = .systemRed
            }
        }
        label.stringValue = text
        label.textColor = color
        label.toolTip = text
    }

    @objc private func restoreDefaults(_ sender: Any?) {
        config = Config()
        settingsPortField?.stringValue = String(Config().port)
        settingsDshField?.stringValue = ""
        settingsNodeField?.stringValue = ""
        settingsLogField?.stringValue = Config().logFile
        settingsAutoOpenCheck?.state = Config().autoOpenBrowser ? .on : .off
        settingsStopOnQuitCheck?.state = Config().stopServiceOnQuit ? .on : .off
        settingsStartOnLoginCheck?.state = Config().autoStartServiceOnLogin ? .on : .off
        updateDshStatus()
        notify("已恢复默认设置（点“保存”生效）")
    }

    // MARK: - 配置读写

    private func loadConfig() {
        if let data = try? Data(contentsOf: configURL),
           let c = try? JSONDecoder().decode(Config.self, from: data) {
            config = c
        }
    }

    private func saveConfig() {
        do {
            try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(config)
            try data.write(to: configURL, options: .atomic)
        } catch {
            notify("保存配置失败：\(error.localizedDescription)")
        }
    }

    // MARK: - 工具

    private func notify(_ msg: String) {
        let n = NSUserNotification()
        n.title = "dsh-bar"
        n.informativeText = msg
        NSUserNotificationCenter.default.deliver(n)
    }

    private func portUp(port: Int) -> Bool {
        guard let out = runShell("/usr/sbin/lsof -nP -iTCP:\(port) -sTCP:LISTEN -t") else { return false }
        return !out.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @discardableResult
    private func runShell(_ cmd: String) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", cmd]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do {
            try p.run()
            p.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }
}

// MARK: - 入口

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
