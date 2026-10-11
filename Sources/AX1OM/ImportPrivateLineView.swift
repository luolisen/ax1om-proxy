import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct ImportPrivateLineView: View {
    @EnvironmentObject private var store: FleetStore
    @Environment(\.dismiss) private var dismiss
    @State private var slot = "azure"
    @State private var type = "link"
    @State private var value = ""
    private var replacesExisting: Bool { store.snapshot.nodes.contains { $0.id == slot } }
    private var isRunning: Bool { store.coreStatus?.running == true }
    private var roleDescription: String {
        switch slot {
        case "la-a": return "默认用于 OpenAI、ChatGPT、Codex、Claude 与 Anthropic。"
        case "panda": return "主线故障时使用，默认不作为首选出口。"
        default: return "默认用于 Google、Gemini、云盘、X / Grok 与 Slack。"
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("导入专线", systemImage: "server.rack").font(.title2.weight(.semibold))
            Text("使用你自己的 VLESS · REALITY · Vision 节点。")
                .font(.callout).foregroundStyle(.secondary)
            Picker("编排位置", selection: $slot) {
                Text("Google / 办公主线 · Azure").tag("azure")
                Text("AI 主线 · 洛杉矶 A").tag("la-a")
                Text("故障备用 · 潘达").tag("panda")
            }.pickerStyle(.menu)
            Text(roleDescription).font(.caption).foregroundStyle(.secondary)
            Picker("来源", selection: $type) {
                Text("VLESS 链接").tag("link")
                Text("配置文件").tag("file")
            }.pickerStyle(.segmented)
            if type == "link" {
                SecureField("vless://…", text: $value).textFieldStyle(.roundedBorder)
            } else {
                HStack {
                    Image(systemName: "doc.text").foregroundStyle(.secondary)
                    Text(value.isEmpty ? "选择 YAML 或 JSON 文件" : URL(fileURLWithPath: value).lastPathComponent)
                        .lineLimit(1).font(.callout)
                    Spacer()
                    Button("选择文件") {
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
                        panel.allowedContentTypes = [UTType.json, UTType(filenameExtension: "yaml") ?? .data, UTType(filenameExtension: "yml") ?? .data]
                        if panel.runModal() == .OK, let url = panel.url { value = url.path }
                    }
                }
                Text("支持含单个 VLESS 节点的 Mihomo YAML 或 sing-box JSON。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if replacesExisting {
                Label("此位置已有专线，导入后将替换它；保留原配置备份。", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption).foregroundStyle(.orange)
            }
            if isRunning {
                Text("请先在设置中停止 AX1OM 内核，再导入专线。")
                    .font(.caption).foregroundStyle(.orange)
            }
            Text("认证只保存在本机，不生成新密钥。编排规则保持不变。")
                .font(.caption).foregroundStyle(.secondary)
            if let message = store.coreMessage { Text(message).font(.caption).foregroundStyle(.secondary) }
            HStack {
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if store.isManagingCore { ProgressView().controlSize(.small) }
                Button(replacesExisting ? "替换并导入" : "导入") {
                    Task {
                        if await store.importPrivateLine(slot: slot, type: type, value: value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                            value = ""; dismiss()
                        }
                    }
                }.buttonStyle(.borderedProminent)
                    .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isManagingCore || isRunning)
            }
        }.padding(26).frame(width: 480)
            .onChange(of: type) { _, _ in value = "" }
            .onDisappear { value = "" }
    }
}
