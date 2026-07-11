---
name: 对标内容雷达
description: 冷静、敏锐、可信的内容研究工作台
colors:
  primary: "oklch(0.487 0.076 202.2)"
  primary-hover: "oklch(0.431 0.068 201.9)"
  accent: "oklch(0.730 0.134 76.5)"
  background: "oklch(1.000 0.000 0)"
  surface: "oklch(0.975 0.002 197.1)"
  surface-strong: "oklch(0.945 0.005 197.1)"
  ink: "oklch(0.239 0.015 218.1)"
  muted: "oklch(0.518 0.016 213.2)"
  border: "oklch(0.910 0.008 197.0)"
  success: "oklch(0.531 0.095 161.9)"
  warning: "oklch(0.611 0.127 61.4)"
  danger: "oklch(0.548 0.165 21.0)"
typography:
  headline:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.3
  title:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.background}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
---

# Design System: 对标内容雷达

## Overview

**Creative North Star: “清晨的编辑台”**

界面像一个内容编辑在清晨打开的安静工作台：背景明亮、信息密度高、重点信号清楚，没有装饰性噪音。矿物青来自 Impeccable 调色种子，用于行动、选中与健康状态；琥珀色只标记需要注意的爆点或风险。

布局以侧栏、工作区、右侧检查器构成。首页直接进入运营判断，不设置营销英雄区；信息主要依赖排版、间距、细分隔线和行级状态组织。

**Key Characteristics:**

- 冷静的白色工作面与轻微冷灰层级
- 单一矿物青主强调色，琥珀只作稀少提示
- 数据密集但不拥挤，解释始终贴近指标
- 150–250ms 状态动效，不做入场表演

## Colors

色彩策略为 Restrained：中性色承担结构，品牌色占据不超过约 10% 的可见面积。

### Primary

- **深海矿物青**：主要按钮、当前导航、链接和运行健康状态。

### Secondary

- **编辑标记琥珀**：爆点提示、预警和需要人工关注的少量信号。

### Neutral

- **纸面白**：主工作区背景。
- **冷雾灰**：侧栏、工具栏和分组背景。
- **石墨墨色**：正文、标题与核心数字。
- **钢灰**：辅助文字、时间与解释。

**The One Signal Rule.** 一个区域只允许一个主要强调色；状态颜色不能同时争夺注意力。

## Typography

**Display Font:** Inter（回退 Segoe UI、Microsoft YaHei）  
**Body Font:** Inter（回退 Segoe UI、Microsoft YaHei）

**Character:** 单一无衬线字体覆盖中文、数字和控件，数字清晰，标签克制，适合长时间阅读。

### Hierarchy

- **Headline**（650，24px，1.3）：页面标题和关键数字。
- **Title**（650，16px，1.4）：区块标题和抽屉标题。
- **Body**（400，14px，1.6）：说明、正文和表格主要内容。
- **Label**（550，12px，1.4）：状态、时间、字段名和辅助元数据。

**The Scan First Rule.** 标题、标签和数字必须独立构成可扫描的信息骨架，说明文字只补充原因。

## Elevation

默认通过色调层级和 1px 分隔线表达深度。阴影只用于浮层、右侧抽屉和悬浮反馈，静态内容区域保持平坦。

### Shadow Vocabulary

- **浮层阴影**（`0 12px 32px rgba(23, 33, 36, 0.12)`）：仅用于抽屉、菜单和临时浮层。

**The Flat By Default Rule.** 如果移除阴影后信息关系仍清楚，就禁止添加阴影。

## Components

### Buttons

- **Shape:** 轻微圆角（6px），高度紧凑，避免胶囊形。
- **Primary:** 矿物青底、白字，水平内边距 14px。
- **Hover / Focus:** 颜色加深；键盘焦点使用 2px 外轮廓，不改变布局。
- **Secondary / Ghost:** 白底细边或透明底，仅在次要操作出现。

### Chips

- **Style:** 浅色背景、深色文字、6px 圆角；仅表达筛选或原因标签。
- **State:** 选中时使用浅矿物青背景和深矿物青文字，不用饱和实色铺满。

### Cards / Containers

- **Corner Style:** 仅交互型重点条目使用 10px 圆角。
- **Background:** 普通分组使用透明或冷雾灰，不把每组都做成卡片。
- **Shadow Strategy:** 静态内容无阴影。
- **Border:** 只在需要区分可点击边界时使用 1px 冷灰线。
- **Internal Padding:** 16–24px。

### Inputs / Fields

- **Style:** 白底、1px 冷灰边、6px 圆角。
- **Focus:** 矿物青边框与 2px 低透明焦点环。
- **Error / Disabled:** 错误包含文字原因；禁用态仍保持足够对比度。

### Navigation

左侧导航使用冷雾灰背景。当前项以浅矿物青完整背景面和更深的文字表达，不添加侧边色条；图标统一为 18px 线性图标，折叠后保留工具提示。

### Today Highlight Row

重点内容以整行可点击形式呈现：左侧显示博主和题目，中间展示入选原因，右侧展示关键指标与箭头；点击后从右侧打开检查器。

## Do's and Don'ts

### Do:

- **Do** 让“为什么值得看”紧贴点赞量、爆款指数和 AI 评分。
- **Do** 使用 8px 基础间距体系和稳定对齐线组织密集信息。
- **Do** 为加载、空数据、失败、离线和权限过期提供明确状态与下一步动作。
- **Do** 让抽屉和行选择使用 150–250ms 的状态过渡。

### Don't:

- **Don't** 使用紫色 AI 渐变、发光玻璃拟态或装饰性大面积渐变。
- **Don't** 把首页做成满屏独立指标卡片或营销式英雄区。
- **Don't** 使用灰字叠在彩色背景上；饱和底色统一使用白字。
- **Don't** 暴露 SenseVoice、FFmpeg 等内部技术名词给普通用户。
- **Don't** 用只有颜色、没有文字或图标的状态表达。
- **Don't** 用加粗彩色侧边条标记选中、警告或重点状态。
