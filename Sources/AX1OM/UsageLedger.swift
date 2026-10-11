import Foundation
import Darwin

enum UsagePeriod: String, Codable, CaseIterable, Identifiable {
    case today, week, month, all
    var id: String { rawValue }
    var title: String {
        switch self { case .today: return "今日"; case .week: return "7天"; case .month: return "30天"; case .all: return "累计" }
    }
}

struct UsageDay: Codable, Identifiable {
    var id: String
    var date: Date
    var upload: Double
    var download: Double
    var serviceBytes: [String: Double]
    var nodeBytes: [String: Double]? = nil
    var nodeNames: [String: String]? = nil
}

struct UsageTotals {
    var upload: Double
    var download: Double
    var total: Double { upload + download }
}

struct UsageServiceTotal: Identifiable {
    var service: ServiceKind
    var bytes: Double
    var id: String { service.rawValue }
}

struct UsageNodeTotal: Identifiable {
    var id: String
    var name: String
    var bytes: Double
}

/// A sampled local ledger, not a provider billing meter or packet capture.
/// Missing samples and initial counters never become invented historical usage.
@MainActor final class UsageLedger {
    private(set) var days: [UsageDay] = []
    private(set) var startedAt: Date
    private(set) var persistenceError: String?
    private let directory: URL
    private let file: URL
    private let calendar: Calendar
    private var previous: Sample?
    private var firstObservation = true
    private var writable = true

    private struct Persisted: Codable {
        var version: Int
        var startedAt: Date
        var days: [UsageDay]
    }
    private struct ConnectionSample {
        var upload: Double
        var download: Double
        var nodeID: String?
    }
    private struct Sample {
        var at: Date
        var upload: Double
        var download: Double
        var connections: [String: ConnectionSample]
    }

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/AX1OM")
        self.file = self.directory.appendingPathComponent("usage.json")
        self.startedAt = Date()
        self.calendar = Calendar.current
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        do {
            let record = try JSONDecoder().decode(Persisted.self, from: Data(contentsOf: file))
            guard [1, 2].contains(record.version), Set(record.days.map(\.id)).count == record.days.count,
                  record.days.allSatisfy({ day in
                      day.upload.isFinite && day.download.isFinite && day.upload >= 0 && day.download >= 0 &&
                      day.serviceBytes.values.allSatisfy({ $0.isFinite && $0 >= 0 }) &&
                      day.serviceBytes.values.reduce(0, +) <= day.upload + day.download + 0.001 &&
                      day.serviceBytes.keys.allSatisfy({ ServiceKind(rawValue: $0) != nil }) &&
                      (day.nodeBytes ?? [:]).values.allSatisfy({ $0.isFinite && $0 >= 0 }) &&
                      (day.nodeBytes ?? [:]).values.reduce(0, +) <= day.upload + day.download + 0.001
                  }) else { throw LedgerError.invalidRecord }
            days = record.days.sorted { $0.date < $1.date }
            startedAt = record.startedAt
            firstObservation = false
        } catch {
            // Preserve a malformed or future-format file instead of overwriting it.
            writable = false
            persistenceError = "本地流量记录无法读取，已保留原文件；本次仅在内存中记录。"
        }
    }

    func observe(_ snapshot: BackendSnapshot, at: Date = Date()) {
        if firstObservation { startedAt = at; firstObservation = false }
        guard snapshot.mihomoRunning, snapshot.errors.isEmpty, !snapshot.mode.contains("模式二"),
              snapshot.uploadTotal.isFinite, snapshot.downloadTotal.isFinite,
              snapshot.uploadTotal >= 0, snapshot.downloadTotal >= 0 else {
            previous = nil
            return
        }
        var connections: [String: ConnectionSample] = [:]
        for c in snapshot.connections where c.upload.isFinite && c.download.isFinite && c.upload >= 0 && c.download >= 0 {
            connections[c.id] = .init(upload: c.upload, download: c.download, nodeID: c.nodeID)
        }
        let current = Sample(at: at, upload: snapshot.uploadTotal, download: snapshot.downloadTotal, connections: connections)
        defer { previous = current }
        guard let old = previous else { persist(); return }
        let elapsed = at.timeIntervalSince(old.at)
        guard elapsed > 0, elapsed <= 30, current.upload >= old.upload, current.download >= old.download else { return }
        let upload = current.upload - old.upload
        let download = current.download - old.download
        let total = upload + download
        guard total.isFinite, total > 0 else { return }

        var attributed: [String: Double] = [:]
        var nodeBytes: [String: Double] = [:]
        var nodeNames: [String: String] = [:]
        for c in snapshot.connections {
            guard let counters = connections[c.id] else { continue }
            let bytes: Double
            if let preceding = old.connections[c.id] {
                guard counters.upload >= preceding.upload, counters.download >= preceding.download else { continue }
                bytes = counters.upload - preceding.upload + counters.download - preceding.download
            } else if let start = parseStart(c.start), start >= old.at, start <= at {
                bytes = counters.upload + counters.download
            } else { continue }
            if bytes > 0 && bytes.isFinite {
                attributed[c.service.rawValue, default: 0] += bytes
                if let id = c.nodeID, let name = c.nodeName, !id.isEmpty, !name.isEmpty,
                   old.connections[c.id] == nil || old.connections[c.id]?.nodeID == id {
                    nodeBytes[id, default: 0] += bytes
                    nodeNames[id] = name
                }
            }
        }
        // Conflicting counters invalidate the attribution for this interval.
        // Preserve the real core delta and leave it unassigned; don't rescale it.
        if attributed.values.reduce(0, +) > total { attributed = [:]; nodeBytes = [:]; nodeNames = [:] }
        distribute(upload: upload, download: download, services: attributed, nodes: nodeBytes, names: nodeNames, from: old.at, to: at)
        days.sort { $0.date < $1.date }
        persist()
    }

    func total(_ period: UsagePeriod, now: Date = Date()) -> UsageTotals {
        selectedDays(period, now: now).reduce(.init(upload: 0, download: 0)) { result, day in
            .init(upload: result.upload + day.upload, download: result.download + day.download)
        }
    }

    func services(_ period: UsagePeriod, now: Date = Date()) -> [UsageServiceTotal] {
        var sum: [String: Double] = [:]
        for day in selectedDays(period, now: now) {
            for (service, bytes) in day.serviceBytes { sum[service, default: 0] += bytes }
        }
        return ServiceKind.allCases.compactMap { service in
            guard let bytes = sum[service.rawValue], bytes > 0 else { return nil }
            return UsageServiceTotal(service: service, bytes: bytes)
        }.sorted { $0.bytes > $1.bytes }
    }

    func nodes(_ period: UsagePeriod, now: Date = Date()) -> [UsageNodeTotal] {
        var sum: [String: Double] = [:], names: [String: String] = [:]
        for day in selectedDays(period, now: now) {
            for (id, bytes) in day.nodeBytes ?? [:] { sum[id, default: 0] += bytes }
            names.merge(day.nodeNames ?? [:]) { _, new in new }
        }
        return sum.compactMap { id, bytes in bytes > 0 ? UsageNodeTotal(id: id, name: names[id] ?? FleetFormat.nodeName(id), bytes: bytes) : nil }.sorted { $0.bytes > $1.bytes }
    }

    private func selectedDays(_ period: UsagePeriod, now: Date) -> [UsageDay] {
        let today = calendar.startOfDay(for: now)
        let start: Date?
        switch period {
        case .today: start = today
        case .week: start = calendar.date(byAdding: .day, value: -6, to: today)
        case .month: start = calendar.date(byAdding: .day, value: -29, to: today)
        case .all: start = nil
        }
        let end = calendar.date(byAdding: .day, value: 1, to: today) ?? now
        return days.filter { day in day.date < end && (start == nil || day.date >= start!) }
    }

    private func distribute(upload: Double, download: Double, services: [String: Double], nodes: [String: Double], names: [String: String], from: Date, to: Date) {
        let duration = to.timeIntervalSince(from)
        var cursor = from
        while cursor < to {
            guard let interval = calendar.dateInterval(of: .day, for: cursor) else { break }
            let end = min(interval.end, to)
            let proportion = end.timeIntervalSince(cursor) / duration
            let identifier = dayID(interval.start)
            let index: Int
            if let existing = days.firstIndex(where: { $0.id == identifier }) { index = existing }
            else {
                days.append(.init(id: identifier, date: interval.start, upload: 0, download: 0, serviceBytes: [:]))
                index = days.count - 1
            }
            days[index].upload += upload * proportion
            days[index].download += download * proportion
            for (service, bytes) in services { days[index].serviceBytes[service, default: 0] += bytes * proportion }
            var recordedNodes = days[index].nodeBytes ?? [:]
            for (id, bytes) in nodes { recordedNodes[id, default: 0] += bytes * proportion }
            days[index].nodeBytes = recordedNodes
            days[index].nodeNames = (days[index].nodeNames ?? [:]).merging(names) { _, new in new }
            cursor = end
        }
    }

    private func dayID(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func parseStart(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    private func persist() {
        guard writable else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            let data = try JSONEncoder().encode(Persisted(version: 2, startedAt: startedAt, days: days))
            let temporary = directory.appendingPathComponent(".usage-" + UUID().uuidString + ".tmp")
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard FileManager.default.createFile(atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600]),
                  rename(temporary.path, file.path) == 0 else { throw LedgerError.writeFailed }
            persistenceError = nil
        } catch { persistenceError = "流量记录保存失败；当前统计仍保留在内存。" }
    }

    private enum LedgerError: Error { case invalidRecord, writeFailed }
}
