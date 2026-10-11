import SwiftUI
import AppKit

struct AddSubscriptionView: View {
    @EnvironmentObject private var store: FleetStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var type = "http"
    @State private var value = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("添加订阅").font(.title2.weight(.semibold))
            TextField("名称", text: $name).textFieldStyle(.roundedBorder)
            Picker("来源", selection: $type) { Text("订阅链接").tag("http"); Text("本地文件").tag("file") }.pickerStyle(.segmented)
            if type == "http" {
                SecureField("HTTPS 订阅链接", text: $value).textFieldStyle(.roundedBorder)
            } else {
                HStack {
                    Text(value.isEmpty ? "未选择文件" : URL(fileURLWithPath: value).lastPathComponent).font(.caption).lineLimit(1)
                    Spacer()
                    Button("选择文件") {
                        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
                        if panel.runModal() == .OK, let url = panel.url { value = url.path }
                    }
                }
            }
            Text("导入节点清单后与现有订阅同时可用。").font(.caption).foregroundStyle(.secondary)
            if let message = store.coreMessage { Text(message).font(.caption).foregroundStyle(.secondary) }
            HStack {
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if store.isManagingCore { ProgressView().controlSize(.small) }
                Button("添加") {
                    Task { if await store.addSubscription(name: name.trimmingCharacters(in: .whitespaces), type: type, value: value) { dismiss() } }
                }.buttonStyle(.borderedProminent).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || value.isEmpty || store.isManagingCore)
            }
        }.padding(26).frame(width: 430).onChange(of: type) { _, _ in value = "" }
    }
}
