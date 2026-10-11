import Foundation
import SwiftUI

struct RatePoint: Identifiable { let id = UUID(); let time: Date; let upload: Double; let download: Double }

@MainActor final class FleetStore: ObservableObject {
    @Published var snapshot = BackendSnapshot.empty
    @Published var routes = RoutePlan.defaults
    @Published var supplementalRoutes = SupplementaryRoute.defaults
    @Published var isRefreshing = false
    @Published var lastRefresh: Date?
    @Published var errorMessage: String?
    @Published var candidateReceipt: CandidateReceipt?
    @Published var isBuildingCandidate = false
    @Published var uploadRate: Double = 0
    @Published var downloadRate: Double = 0
    @Published var rates: [RatePoint] = []
    @Published var usageDays: [UsageDay] = []
    @Published var usageStartedAt: Date = Date()
    @Published var usagePersistenceError: String?
    @Published var ipDiagnostics: IPDiagnosticsSnapshot?
    @Published var isCheckingIP = false
    @Published var ipCheckError: String?
    @Published var closingConnectionID: String?
    @Published var connectionCloseReceipt: ConnectionCloseReceipt?
    @Published var coreStatus: CoreStatus?
    @Published var isManagingCore = false
    @Published var coreMessage: String?
    private let core = CoreControl()
    var ownsRunningCore: Bool { snapshot.mode.contains("AX1OM") && snapshot.mihomoRunning }
    private let usageLedger = UsageLedger()
    private let backend = LiveBackend()
    private var polling = false
    private var previousTotals: (Date, Double, Double)?
    private let defaults = UserDefaults.standard
    var isStale: Bool { lastRefresh.map { Date().timeIntervalSince($0) > max(15, defaults.double(forKey: "refreshSeconds") * 3) } ?? true }
    var hasDraftChanges: Bool { routes != RoutePlan.defaults }
    var totalConnections: Int { snapshot.connections.count }
    var hasCumulativeTraffic: Bool { !snapshot.mode.hasPrefix("模式二") }
    var draftURL: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/AX1OM/routes-draft.json") }

    var supplementalURL: URL { draftURL.deletingLastPathComponent().appendingPathComponent("supplemental-draft.json") }
    init() {
        usageDays = usageLedger.days
        usageStartedAt = usageLedger.startedAt
        usagePersistenceError = usageLedger.persistenceError
        if let data = try? Data(contentsOf: supplementalURL), let saved = try? JSONDecoder().decode([SupplementaryRoute].self, from: data), Set(saved.map(\.id)) == Set(SupplementaryRoute.defaults.map(\.id)), saved.count == SupplementaryRoute.defaults.count, saved.allSatisfy({ SupplementaryRoute.allowed.contains($0.primary) }) {
            supplementalRoutes = SupplementaryRoute.defaults.map { original in var row = original; row.primary = saved.first(where: { $0.id == row.id })!.primary; return row }
        }
        if let data = try? Data(contentsOf: draftURL), let saved = try? JSONDecoder().decode([RoutePlan].self, from: data), Set(saved.map(\.id)) == Set(RoutePlan.defaults.map(\.id)), saved.allSatisfy({ ["azure", "la-a", "panda"].contains($0.primary) && $0.backup == "panda" }) { routes = saved }
    }
    func startPolling() async {
        guard !polling else { return }; polling = true
        defer { polling = false }
        while !Task.isCancelled {
            await refresh()
            let configured = defaults.double(forKey: "refreshSeconds")
            let interval = configured > 0 ? min(30, max(3, configured)) : 4
            try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
        }
    }
    func refresh() async {
        guard !isRefreshing else { return }; isRefreshing = true
        defer { isRefreshing = false }
        do {
            let next = try await backend.fetchSnapshot()
            let now = Date()
            usageLedger.observe(next, at: now)
            usageDays = usageLedger.days
            usagePersistenceError = usageLedger.persistenceError
            if !next.mode.hasPrefix("模式二"), snapshot.mode == next.mode, let (at, up, down) = previousTotals {
                let elapsed = max(0.25, now.timeIntervalSince(at))
                uploadRate = max(0, next.uploadTotal - up) / elapsed
                downloadRate = max(0, next.downloadTotal - down) / elapsed
            } else { uploadRate = 0; downloadRate = 0 }
            previousTotals = (now, next.uploadTotal, next.downloadTotal)
            snapshot = next; lastRefresh = now; errorMessage = nil
            coreStatus = try? await core.status()
            rates.append(.init(time: now, upload: uploadRate, download: downloadRate))
            if rates.count > 90 { rates.removeFirst(rates.count - 90) }
        } catch { errorMessage = error.localizedDescription; uploadRate = 0; downloadRate = 0 }
    }
    func usageTotals(_ period: UsagePeriod) -> UsageTotals { usageLedger.total(period) }
    func usageServices(_ period: UsagePeriod) -> [UsageServiceTotal] { usageLedger.services(period) }
    func usageNodes(_ period: UsagePeriod) -> [UsageNodeTotal] { usageLedger.nodes(period) }
    func updatePrimary(routeID: String, nodeID: String) {
        guard ["azure", "la-a", "panda"].contains(nodeID), let index = routes.firstIndex(where: { $0.id == routeID }) else { return }
        routes[index].primary = nodeID; candidateReceipt = nil
        do {
            try FileManager.default.createDirectory(at: draftURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(routes).write(to: draftURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: draftURL.path)
        } catch { errorMessage = "草稿保存失败：\(error.localizedDescription)" }
    }
    func updateSupplemental(routeID: String, nodeID: String) {
        guard SupplementaryRoute.allowed.contains(nodeID), let index = supplementalRoutes.firstIndex(where: { $0.id == routeID }) else { return }
        supplementalRoutes[index].primary = nodeID
        candidateReceipt = nil
        do {
            try FileManager.default.createDirectory(at: supplementalURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(supplementalRoutes).write(to: supplementalURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: supplementalURL.path)
        } catch { errorMessage = "编排保存失败：\(error.localizedDescription)" }
    }
    func generateCandidate() async {
        guard !isBuildingCandidate else { return }; isBuildingCandidate = true
        defer { isBuildingCandidate = false }
        do {
            coreStatus = try await core.prepare()
            let receipt = try await backend.providerAction("build", routes: routes, supplemental: supplementalRoutes)
            if coreStatus?.running == true { coreStatus = try await core.reloadConfig() }
            let message = coreStatus?.running == true ? "编排已应用，内核未重启。" : "配置已保存，启动内核后生效。"
            candidateReceipt = .init(success: true, path: receipt.configPath, reportPath: nil, notes: [message])
            coreMessage = message
        } catch { candidateReceipt = .init(success: false, path: nil, reportPath: nil, notes: [error.localizedDescription]) }
        await refresh()
    }

    func importExistingConfiguration() async {
        await manageCore {
            self.coreStatus = try await self.core.prepare()
            let receipt = try await self.backend.providerAction("import")
            self.coreMessage = "已导入 \(receipt.sources?.count ?? 0) 份订阅，原代理保持运行。"
            _ = try await self.backend.providerAction("build", routes: self.routes, supplemental: self.supplementalRoutes)
        }
    }
    func startCore(tun: Bool) async {
        await manageCore {
            self.coreStatus = try await self.core.prepare()
            if !FileManager.default.fileExists(atPath: self.coreStatus!.configPath) {
                _ = try await self.backend.providerAction("build", routes: self.routes, supplemental: self.supplementalRoutes)
            }
            self.coreStatus = tun ? try await self.core.startTUN() : try await self.core.startIsolated()
            self.coreMessage = self.coreStatus?.message
        }
    }
    func stopCore() async {
        await manageCore { self.coreStatus = try await self.core.stop(); self.coreMessage = self.coreStatus?.message }
    }
    func selectNode(group: String, node: String) async {
        guard ownsRunningCore else { return }
        await manageCore { self.coreStatus = try await self.core.selectNode(group: group, node: node); self.coreMessage = self.coreStatus?.message }
    }
    func updateProvider(id: String) async {
        guard ownsRunningCore else { return }
        await manageCore { self.coreStatus = try await self.core.updateProvider(name: String(id.dropFirst("profile-".count))); self.coreMessage = self.coreStatus?.message }
    }
    func addSubscription(name: String, type: String, value: String) async -> Bool {
        guard !isManagingCore else { return false }
        var succeeded = false
        await manageCore {
            self.coreStatus = try await self.core.prepare()
            _ = try await self.backend.providerAction("add", name: name, type: type, url: type == "http" ? value : nil, path: type == "file" ? value : nil)
            _ = try await self.backend.providerAction("build", routes: self.routes, supplemental: self.supplementalRoutes)
            if self.coreStatus?.running == true { self.coreStatus = try await self.core.reloadConfig() }
            self.coreMessage = "订阅已添加。"; succeeded = true
        }
        return succeeded
    }
    private func manageCore(_ operation: () async throws -> Void) async {
        guard !isManagingCore else { return }; isManagingCore = true
        defer { isManagingCore = false }
        do { try await operation() }
        catch { coreMessage = error.localizedDescription }
        await refresh()
    }

    func checkIP() async {
        guard !isCheckingIP else { return }
        isCheckingIP = true; ipCheckError = nil
        defer { isCheckingIP = false }
        do { ipDiagnostics = try await backend.checkIP() }
        catch { ipCheckError = "检测未完成，请重试。" }
    }

    func closeConnection(id: String) async {
        guard closingConnectionID == nil else { return }
        closingConnectionID = id; connectionCloseReceipt = nil
        defer { closingConnectionID = nil }
        do { connectionCloseReceipt = try await backend.closeConnection(id: id) }
        catch { connectionCloseReceipt = .init(success: false, message: "终结失败，请刷新后重试。") }
        await refresh()
    }
}
