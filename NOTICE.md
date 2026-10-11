# 第三方组件与许可证

AX1OM Network 源码采用 GPL-3.0-only。发行包包含以下第三方软件，原作者的权利和许可证继续适用。

| 组件 | 用途 | 上游与许可证 |
| --- | --- | --- |
| Mihomo 1.19.32 | 代理、规则、DNS 与 TUN 核心 | [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)，GPL-3.0 |
| Node.js 26.9.0 | 本机适配器运行时 | [nodejs/node](https://github.com/nodejs/node)，MIT 及其内置第三方组件条款 |
| yaml 2.9.0 | YAML 解析与序列化 | [eemeli/yaml](https://github.com/eemeli/yaml)，ISC；源码内置版本 2.9.0 |

上述发行组件版本与官方下载来源由 `scripts/fetch-runtime.py` 固定，并校验下载包的 SHA-256。Node.js 发行内容还包含多个第三方依赖，不能只以一行 MIT 声明替代上游的完整 LICENSE。发行包应保留运行库许可证与获取信息；重新分发时应同时保留本文件、应用 LICENSE 和第三方许可证。

YAML 运行库位于 `Sources/AX1OM/Resources/vendor/yaml/`，其完整 ISC 条款保存在该目录的 `LICENSE`。

对包含 GPL 组件的二进制发布，本项目同时提供与发布标签对应的源代码及构建说明。发行页还附带固定版本的 Mihomo 核心源码归档，便于取得对应源码。修改或重新分发时，应遵循适用 GPL 条款并提供对应源码；本说明不改变任何上游许可证。

AX1OM 名称和标识用于项目识别。源码开源不表示第三方项目认可本产品，也不授予以 AX1OM 官方身份发布、宣传或提供节点服务的权利。
