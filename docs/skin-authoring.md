# 为 LaTeX Question Bank 编写皮肤

皮肤是本地设计数据，仅包含颜色和枚举布局选项。不支持 CSS、脚本、URL、图片或路径，也不会改题库内容。渲染端的皮肤应用由独立任务实现。

## Agent 工作流程

```bash
lqb skin init my-skin --from sheet --out skin.json
# 编辑 skin.json
lqb skin validate --file skin.json --json
lqb skin install --file skin.json --json
lqb skin list --json
# 更新同 id 的皮肤时显式覆盖
lqb skin install --file skin.json --overwrite --json
lqb skin remove my-skin
```

`init` 默认复制 `sheet`，默认输出当前目录的 `skin.json`，已有输出文件会被拒绝以保护用户文件。`--from` 接受 sheet、porcelain、darkroom、pine。`init` 和 `validate` 完全离线，无需应用运行、题库或发现文件。其余命令通过本地 API 操作，需先启动应用，不要求打开 workspace。不要直接写应用数据目录。

`validate --json` 返回 `{ok:true,value:…}` 或 `{ok:false,errors:[{code,field,message}]}`；失败时也向 stderr 输出修复信息。退出码沿用 agent-workflow.md：成功 0，用法或其他请求失败 1，数据校验失败 2，连接应用或 token 失败 5。未加 overwrite 的同 id 安装返回 409 SKIN_EXISTS，退出码 1。

## 文件字段与选项

顶层字段全部必填：`schemaVersion: 1`、`id`、`name`、`mode`、`tokens`、`options`。不允许任何层级的未知字段（包括 `$schema`；在编辑器设置中关联 schema 文件）。

- id 必须符合 `^[a-z0-9][a-z0-9-]{0,39}$`，不能使用四个内置 id。
- name 为 1–40 个 Unicode 字符。
- mode 为 light 或 dark，代表皮肤所属外观。
- 所有 token 必填，颜色仅接受 #RRGGBB 或 #RRGGBBAA（大小写均可）。原型的 transparent 表示为 #00000000；rgba 遮罩的 alpha 四舍五入到最近的 8 位整数。
- 原始 UTF-8 文件最多 16 KiB（包括空白）。

| options 字段 | 取值与用途 |
| --- | --- |
| nav | rail：侧栏图标与文字；railIcons：纯图标侧栏；top：顶部导航；topCentered：顶部居中导航 |
| preview | flat：平面预览；sheet：居中稿纸；paper：带纸张质感的预览布局 |
| radius | 0–10 的整数，统一控件圆角（px） |
| density | comfortable：舒适间距；compact：紧凑间距 |
| headingFont | sans：无衬线标题；book：书籍正文风格标题 |

## 全部颜色 token

| token | 用途 |
| --- | --- |
| `surface` | 应用主背景 |
| `chrome` | 导航、侧栏、详情区背景 |
| `text` | 主要文字 |
| `dim` | 次要文字与占位文字 |
| `border` | 普通分隔线 |
| `borderStrong` | 强调边框 |
| `accent` | 主要行动背景与强调色 |
| `onAccent` | 主要行动上的文字 |
| `active` | 当前导航或选中项背景 |
| `activeLine` | 选中项边框 |
| `field` | 输入框背景 |
| `well` | 分段控件、标签的凹槽背景 |
| `raised` | 分段控件选中项表面 |
| `raisedSolid` | 需要不透明底的浮层表面 |
| `scrim` | 弹层遮罩 |
| `codeBg` | 代码编辑器背景 |
| `syntax` | LaTeX 语法强调 |
| `previewBg` | 预览区背景 |
| `page` | 预览纸张背景 |
| `pageInk` | 纸张上的文字与数学内容 |
| `must` | 必须看优先级 |
| `onMust` | 必须看上的文字 |
| `recheck` | 再检查优先级 |
| `recheckSoft` | 再检查格子的浅底色 |
| `skip` | 可跳过优先级 |
| `unset` | 未标记分布色 |
| `unsetLine` | 未标记圆点边框 |
| `danger` | 危险操作与错误 |
| `success` | 成功状态 |
| `warning` | 警告状态 |

## 校验与修复

按 WCAG sRGB 相对亮度计算对比度，以下七组至少 4.5:1：text/surface、text/chrome、dim/surface、dim/chrome、onAccent/accent、onMust/must、pageInk/page。这些配对的两个颜色必须是六位颜色，即便 alpha 为 FF 也拒绝八位写法；其他 token 可用八位颜色。must、recheck、skip 忽略字母大小写后必须两两不同。

| 错误码 | 修复 |
| --- | --- |
| SKIN_JSON | 修复 JSON 语法（例如删除尾逗号） |
| SKIN_INVALID | 将根值改为 JSON 对象 |
| SKIN_UNKNOWN_FIELD | 删除信息中指出的字段，检查拼写 |
| SKIN_VERSION | 把 schemaVersion 改为 1 |
| SKIN_ID | 修复 id 格式；存储文件名必须与 id 一致 |
| SKIN_BUILTIN | 使用自定义 id，不能覆盖或删除内置皮肤 |
| SKIN_NAME | 使用 1–40 个字符的名称 |
| SKIN_MODE | 使用 light 或 dark |
| SKIN_TOKENS / SKIN_COLOR | 补齐全部 token，颜色改为六位或八位十六进制 |
| SKIN_OPTIONS / SKIN_OPTION | 补齐 options 并使用表格中的枚举或整数 |
| SKIN_ALPHA | 对比度配对改用六位不透明颜色 |
| SKIN_CONTRAST | 根据返回的字段配对及实际比值调整前景或背景，达到 4.5:1 |
| SKIN_PRIORITY | 让 must、recheck、skip 两两不同 |
| SKIN_TOO_LARGE | 缩减整个 UTF-8 文件到 16 KiB 以内 |
| SKIN_EXISTS | 检查已有皮肤；确认替换后再加 --overwrite |
| SKIN_OVERWRITE | API overwrite 查询参数仅使用 true 或 false |
| SKIN_PATH | 移除符号链接、目录等非普通文件或越界路径 |
| SKIN_READ | 检查文件权限和内容 |
| SKIN_NOT_FOUND | 先 list，确认 id 或重新安装 |

[JSON Schema](skin.schema.json) 来自 `shared/skins.ts` 的 `SKIN_JSON_SCHEMA`，测试保证产物一致。重新生成：

```bash
node --import tsx --input-type=module -e 'import {SKIN_JSON_SCHEMA} from "./shared/skins.ts"; import {writeFileSync} from "node:fs"; writeFileSync("docs/skin.schema.json", JSON.stringify(SKIN_JSON_SCHEMA,null,2)+"\n");'
```

Schema 提供结构与字段校验；文件字节上限、对比度、配对透明度和优先级颜色不同仍须运行 `lqb skin validate` 检查。

## 本地 API 与存储

- GET /api/skins 返回 `{skins: Skin[], errors: [{file, code, field, message}]}`，内置在前、自定义按文件名排序。无效 .json 文件列为错误，不影响其他皮肤。skins 目录本身不安全时也返回错误项。
- POST /api/agent/skins 直接发送 skin.json 对象；覆盖时加 `?overwrite=true`，返回安装后的皮肤。
- DELETE /api/agent/skins/:id 返回 `{removed: id}`。不接受任意路径。
- 写接口需要发现文件中的 Bearer token；全部接口保持原始 Host 与写入 Origin 校验。
- 自定义文件位于 `<appDataDir>/skins/<id>.json`；写入串行化并通过临时文件 rename 原子替换。拒绝符号链接、非普通文件和路径逃逸。
- 成功安装、覆盖或删除后，/api/events 广播 `event: skins-changed`、`data: {"id":"…"}`；失败时不广播。
- 不写 workspace、bank.json 或 .history。偏好增加 skinMode（system/light/dark）、lightSkinId、darkSkinId，旧数据归一化为 system、sheet、darkroom；合法自定义 id 会保留。

## 完整可用示例

```json
{
  "schemaVersion": 1,
  "id": "my-skin",
  "name": "我的皮肤",
  "mode": "light",
  "tokens": {
    "surface": "#FBFCFA",
    "chrome": "#F1F4F2",
    "text": "#14264F",
    "dim": "#5B6880",
    "border": "#DDE3E2",
    "borderStrong": "#C4CDD0",
    "accent": "#14264F",
    "onAccent": "#FBFCFA",
    "active": "#FBFCFA",
    "activeLine": "#C4CDD0",
    "field": "#FBFCFA",
    "well": "#E6EBEA",
    "raised": "#FFFFFF",
    "raisedSolid": "#FFFFFF",
    "scrim": "#14264F38",
    "codeBg": "#F6F8F6",
    "syntax": "#A82C44",
    "previewBg": "#FBFCFA",
    "page": "#FBFCFA",
    "pageInk": "#14264F",
    "must": "#C4314B",
    "onMust": "#FFFFFF",
    "recheck": "#6E7EA0",
    "recheckSoft": "#CDD4E2",
    "skip": "#A9B3BE",
    "unset": "#E2E7E7",
    "unsetLine": "#B9C1C8",
    "danger": "#B3293F",
    "success": "#1B6B4F",
    "warning": "#8A5A00"
  },
  "options": {
    "nav": "rail",
    "preview": "flat",
    "radius": 3,
    "density": "comfortable",
    "headingFont": "sans"
  }
}
```
