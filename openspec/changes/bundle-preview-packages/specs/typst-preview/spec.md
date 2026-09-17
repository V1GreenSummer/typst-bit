# Delta Spec: typst-preview

## ADDED Requirements

### Requirement: 预置包解析

系统 SHALL 解析随应用预置的 Typst 包（`@namespace/name:version`，首批 `@preview/tiaoma:0.3.0`）：包文件 SHALL 在首次使用该包的编译前从同源装载，装载后的编译 MUST NOT 依赖网络；包仅在首次使用时加载，MUST NOT 计入首载传输。未预置的包导入 SHALL 给出可读诊断，且保留上次成功预览。

#### Scenario: 预置包导入编译成功

- **WHEN** 用户源码导入 `@preview/tiaoma:0.3.0` 并调用其二维码函数
- **THEN** 应用自动装载预置包文件（同源抓取），随后编译成功、预览更新

#### Scenario: 装载后编译离线可用

- **WHEN** 包已装载完成，此时网络不可用，用户再次编辑并触发重编译
- **THEN** 编译正常完成，无网络请求发出

#### Scenario: 未预置包给出可读诊断

- **WHEN** 用户导入一个未预置的包
- **THEN** 诊断区显示可读错误信息，预览保留上次成功结果

#### Scenario: 包仅在首次使用时抓取

- **WHEN** 用户连续多次编译同一个使用了预置包的文档
- **THEN** 包文件只在首次编译前抓取一次，后续编译不再重复抓取
