# Delta Spec: workbench-editor

## Purpose

定义浏览器编辑工作台的统一命令分发与编辑会话行为：所有用户可触发的编辑动作来自单一命令目录，编辑状态由单一会话对象持有，且具备不依赖浏览器的命令层测试。

## ADDED Requirements

### Requirement: 统一命令目录

系统 SHALL 以单一命令目录定义所有用户可触发的编辑动作（菜单、工具栏、快捷键、命令面板），每个命令 SHALL 含稳定 id、显示名、可选快捷键与执行入口；同一动作的行为修改 MUST 只改一处。

#### Scenario: 菜单、工具栏与快捷键同源

- **WHEN** 用户通过菜单项、工具栏按钮或快捷键触发同一动作（如加粗）
- **THEN** 三条路径调用同一命令实现，文档结果与撤销栈行为完全一致

#### Scenario: 命令状态反馈

- **WHEN** 光标或选区位于可应用命令的上下文（如选区可加粗）
- **THEN** catalog 判定该命令 active；不满足条件时命令 disabled，UI 相应高亮或置灰

### Requirement: 命令面板

系统 SHALL 提供由 ⌘K / Ctrl+K 打开的命令面板，支持按显示名或 id 过滤、键盘上下导航、Enter 执行、Escape 关闭；执行路径 MUST 与菜单完全一致。

#### Scenario: 打开、过滤与执行

- **WHEN** 用户打开命令面板并输入过滤词后按 Enter
- **THEN** 面板显示匹配命令列表，执行当前选中命令并关闭面板，编辑器内容与撤销栈按该命令更新

#### Scenario: Escape 关闭不执行

- **WHEN** 用户在命令面板中按 Escape
- **THEN** 面板关闭且不执行任何命令

### Requirement: 编辑会话单一状态

系统 SHALL 以单一会话对象持有源码、选区、编译状态、revision、诊断与预览信息；e2e compat 暴露的 `e2e_*` 读取 MUST 反映同一会话，MUST NOT 出现与 UI 分叉的第二份状态。

#### Scenario: 编译状态迁移一致

- **WHEN** 源码经由防抖或立即编译触发一次成功编译
- **THEN** 会话的 revision 单调递增、诊断清空、预览信息对应最新 revision，compat `e2e_*` 读取与 UI 显示一致

#### Scenario: 恢复示例重置会话

- **WHEN** 用户执行「恢复示例」
- **THEN** 源码、选区、诊断、预览与页码重置为默认文档编译后的状态

### Requirement: 命令层自动化测试

命令目录与会话 MUST 具备不依赖浏览器的自动化测试，覆盖命令分发、过滤、active 判定与会话状态迁移；测试 SHALL 可作为独立命令运行。

#### Scenario: 无浏览器命令层回归

- **WHEN** 运行命令层测试脚本
- **THEN** 在不启动浏览器的前提下完成命令与会话断言并给出通过/失败退出码
