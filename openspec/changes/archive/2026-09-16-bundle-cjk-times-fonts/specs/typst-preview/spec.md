# Delta Spec: typst-preview

## ADDED Requirements

### Requirement: 字体覆盖（CJK 与 Times 风格西文）

系统 SHALL 随应用预置覆盖 GB2312 字符集（6,763 汉字及常用标点）的中文字体，以及 Times New Roman 度量兼容的西文字体；对于 GB2312 覆盖范围内的字符，编译与导出的 PDF MUST NOT 出现缺字（`.notdef`）字形。默认西文字体 SHALL 为 Times New Roman 度量兼容字体，默认中文字体 SHALL 为思源宋体（Noto Serif CJK SC）。字体预置 MUST NOT 依赖网络请求，离线语义与「纯客户端编译」要求一致。GB2312 覆盖范围之外的生僻字不在本要求内。

#### Scenario: 中文文档编译与导出无缺字

- **WHEN** 用户编译包含中文的文档并导出 PDF
- **THEN** PDF 中 GB2312 覆盖范围内的 CJK 字符均由内置中文字体渲染，无缺字框，且文本可被标准 PDF 工具完整提取

#### Scenario: 默认西文为 Times 风格

- **WHEN** 用户在新文档中输入英文且未显式指定字体
- **THEN** 英文使用 Times New Roman 度量兼容字体渲染（字符前进宽度与 Times New Roman 一致）

#### Scenario: 中西文混排

- **WHEN** 文档同时包含英文与中文
- **THEN** 西文使用 Times 风格字体、中文使用思源宋体，二者均无缺字，基线对齐正常

#### Scenario: 粗体中文

- **WHEN** 中文内容使用加粗（例如标题 `= 中文标题`）
- **THEN** 使用思源宋体 Bold 字重渲染，MUST NOT 回退为缺字或错误字重

#### Scenario: 断网下中文编译

- **WHEN** 应用完成首次加载且页面保持打开，网络不可用，用户编译含中文的文档
- **THEN** 编译与预览正常完成，无网络请求发出
