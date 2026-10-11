import Foundation
import Security
import Darwin

struct CoreStatus: Codable, Sendable {
    var running: Bool
    var mode: String
    var pid: Int?
    var message: String
    var configPath: String
}

struct CoreControl {
    func prepare() async throws -> CoreStatus { try await run(["action": "prepare"]) }
    func status() async throws -> CoreStatus { try await run(["action": "status"]) }
    func startIsolated() async throws -> CoreStatus { try await run(["action": "start-isolated"]) }
    func startTUN() async throws -> CoreStatus {
        _ = try await run(["action": "preflight-tun"])
        return try await privileged(action: "--start-tun")
    }
    func stop() async throws -> CoreStatus {
        let current = try await status()
        return current.mode == "tun" ? try await privileged(action: "--stop") : try await run(["action": "stop"])
    }
    func reloadConfig() async throws -> CoreStatus { try await run(["action": "reload-config"]) }
    func selectNode(group: String, node: String) async throws -> CoreStatus { try await run(["action": "select-node", "group": group, "node": node]) }
    func updateProvider(name: String) async throws -> CoreStatus { try await run(["action": "update-provider", "name": name]) }

    private func resources() throws -> (node: URL, mihomo: URL, script: URL) {
        guard let base = Bundle.main.resourceURL else { throw CoreControlError.message("缺少应用内核资源。") }
        let node = base.appendingPathComponent("bin/node")
        let mihomo = base.appendingPathComponent("bin/mihomo")
        let script = base.appendingPathComponent("AX1OM_AX1OM.bundle/Resources/core-manager.cjs")
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.isExecutableFile(atPath: mihomo.path), FileManager.default.fileExists(atPath: script.path) else {
            throw CoreControlError.message("缺少应用内置运行组件，请重新安装完整版本。")
        }
        return (node, mihomo, script)
    }
    private func decode(_ data: Data) throws -> CoreStatus {
        guard data.count <= 65536, let value = try? JSONDecoder().decode(CoreStatus.self, from: data) else { throw CoreControlError.message("内核响应格式无效。") }
        guard value.mode != "error" else { throw CoreControlError.message(value.message) }
        return value
    }
    private func run(_ input: [String: String]) async throws -> CoreStatus {
        let resource = try resources(), data = try JSONEncoder().encode(input)
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process(), output = Pipe(), stdin = Pipe(), stderr = Pipe()
                process.executableURL = resource.node; process.arguments = [resource.script.path]
                var environment = ProcessInfo.processInfo.environment
                environment["AX1OM_MIHOMO_BINARY"] = resource.mihomo.path
                process.environment = environment; process.standardOutput = output; process.standardInput = stdin; process.standardError = stderr
                do {
                    try process.run(); try stdin.fileHandleForWriting.write(contentsOf: data); try stdin.fileHandleForWriting.close()
                    let timer = DispatchWorkItem { if process.isRunning { process.terminate() } }
                    DispatchQueue.global().asyncAfter(deadline: .now() + 55, execute: timer)
                    let response = output.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit(); timer.cancel()
                    continuation.resume(returning: try decode(response))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private func privileged(action: String) async throws -> CoreStatus {
        let resource = try resources()
        let launcher = resource.node.deletingLastPathComponent().appendingPathComponent("ax1om-privileged-launcher")
        guard FileManager.default.isExecutableFile(atPath: launcher.path) else { throw CoreControlError.message("缺少管理员启动组件，请重新安装完整版本。") }
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process(), output = Pipe()
                process.executableURL = launcher; process.arguments = [action]
                process.standardOutput = output; process.standardError = FileHandle.nullDevice
                do {
                    try process.run()
                    let response = output.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit()
                    continuation.resume(returning: try decode(response))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
}

enum CoreControlError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}
