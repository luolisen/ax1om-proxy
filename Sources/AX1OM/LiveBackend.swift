import Foundation
import Darwin

/// Adapts bundled runtime tools to the native interface.
struct LiveBackend {
    private func nodeExecutable() throws -> URL {
        let manager = FileManager.default
        let environment = ProcessInfo.processInfo.environment
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("bin/node").path
        let home = manager.homeDirectoryForCurrentUser.path
        let candidates = [bundled, environment["AX1OM_NODE_BINARY"], home + "/.local/bin/node", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
            .compactMap { $0 } + (environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/node" }
        guard let path = candidates.first(where: { $0.hasPrefix("/") && manager.isExecutableFile(atPath: $0) }) else {
            throw AdapterError.message("缺少随应用提供的本机运行组件。")
        }
        return URL(fileURLWithPath: path)
    }

    func fetchSnapshot() async throws -> BackendSnapshot {
        let data = try await run(resource: "native-bridge.cjs", input: nil, timeout: 24)
        do { return try JSONDecoder().decode(BackendSnapshot.self, from: data) }
        catch { throw AdapterError.message("本机状态格式不兼容；未显示未校验的数据。") }
    }

    func checkIP() async throws -> IPDiagnosticsSnapshot {
        let data = try await run(resource: "ip-diagnostics.cjs", input: nil, timeout: 50)
        return try JSONDecoder().decode(IPDiagnosticsSnapshot.self, from: data)
    }

    func closeConnection(id: String) async throws -> ConnectionCloseReceipt {
        struct Input: Encodable { var id: String }
        let input = try JSONEncoder().encode(Input(id: id))
        let data = try await run(resource: "native-bridge.cjs", arguments: ["--close-connection"], input: input, timeout: 12)
        return try JSONDecoder().decode(ConnectionCloseReceipt.self, from: data)
    }

    func buildCandidate(routes: [RoutePlan], supplemental: [SupplementaryRoute]) async throws -> CandidateReceipt {
        struct Input: Encodable { var routes: [RoutePlan]; var supplemental: [SupplementaryRoute] }
        let input = try JSONEncoder().encode(Input(routes: routes, supplemental: supplemental))
        let data = try await run(resource: "fleet-compiler.cjs", arguments: ["--build"], input: input, timeout: 75)
        do { return try JSONDecoder().decode(CandidateReceipt.self, from: data) }
        catch { throw AdapterError.message("候选生成器未返回有效结果；生产配置未应用。") }
    }

    func run(resource: String, arguments: [String] = [], input: Data?, timeout: TimeInterval) async throws -> Data {
        let packagedURL = Bundle.main.resourceURL?.appendingPathComponent("AX1OM_AX1OM.bundle/Resources/" + resource)
        var resourceURL = packagedURL.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
        #if DEBUG
        resourceURL = resourceURL ?? Bundle.module.url(forResource: resource, withExtension: nil, subdirectory: "Resources")
        #endif
        guard let resourceURL else {
            throw AdapterError.message("缺少本机适配器资源。")
        }
        let executable = try nodeExecutable()
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process()
                let stdout = Pipe(), stderr = Pipe(), stdin = Pipe()
                process.executableURL = executable
                var environment = ProcessInfo.processInfo.environment
                environment["AX1OM_NODE_BINARY"] = executable.path
                if let binary = Bundle.main.resourceURL?.appendingPathComponent("bin/mihomo"), FileManager.default.isExecutableFile(atPath: binary.path) {
                    environment["AX1OM_MIHOMO_BINARY"] = binary.path
                }
                process.environment = environment
                process.arguments = [resourceURL.path] + arguments
                process.standardOutput = stdout; process.standardError = stderr
                process.standardInput = stdin
                do { try process.run() }
                catch {
                    continuation.resume(throwing: AdapterError.message("无法启动本机适配器；请检查本地 Node 运行环境。"))
                    return
                }
                let output = ProcessOutput()
                let readers = DispatchGroup()
                readers.enter()
                DispatchQueue.global(qos: .utility).async {
                    output.set(stdout.fileHandleForReading.readDataToEndOfFile())
                    readers.leave()
                }
                readers.enter()
                DispatchQueue.global(qos: .utility).async {
                    _ = stderr.fileHandleForReading.readDataToEndOfFile()
                    readers.leave()
                }
                if let input { try? stdin.fileHandleForWriting.write(contentsOf: input) }
                try? stdin.fileHandleForWriting.close()
                let deadline = ProcessDeadline()
                let timer = DispatchWorkItem {
                    guard process.isRunning else { return }
                    deadline.markExpired()
                    process.terminate()
                    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 2) {
                        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                    }
                }
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: timer)
                // Foundation delivers termination events on the launching thread's
                // run loop. A semaphore wait on a GCD worker does not pump that
                // loop; waitUntilExit does and also reaps the child correctly.
                process.waitUntilExit()
                timer.cancel()
                if deadline.expired {
                    _ = readers.wait(timeout: .now() + 3)
                    continuation.resume(throwing: AdapterError.message("本机读取超时；没有变更现有代理。"))
                    return
                }
                _ = readers.wait(timeout: .now() + 3)
                let data = output.get()
                guard process.terminationStatus == 0, !data.isEmpty, data.count <= 8_000_000 else {
                    continuation.resume(throwing: AdapterError.message("本机适配器读取失败；敏感原始输出已隐藏。"))
                    return
                }
                continuation.resume(returning: data)
            }
        }
    }
}

private final class ProcessOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    func set(_ value: Data) { lock.lock(); defer { lock.unlock() }; data = value }
    func get() -> Data { lock.lock(); defer { lock.unlock() }; return data }
}

private final class ProcessDeadline: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func markExpired() { lock.lock(); defer { lock.unlock() }; value = true }
    var expired: Bool { lock.lock(); defer { lock.unlock() }; return value }
}

private enum AdapterError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let value): return value } }
}
