# AI PPT Tutor

一个基于 PDF / PPTX 课件的 AI 学习工作区。上传课件后，系统会按页或幻灯片提取文本、建立分块索引，并在讲解、问答、练习和复习模式中返回可核查的课件来源。

## 本地运行

环境要求：Node.js 22.13 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后打开 [http://localhost:3000](http://localhost:3000)。在 `.env.local` 中填写 DashScope API Key 后，才能使用 AI 生成能力：

```dotenv
DASHSCOPE_API_KEY=your_dashscope_api_key
DASHSCOPE_VISION_MODEL=qwen3-vl-plus
CHECKPOINT_SIGNING_SECRET=a_different_long_random_secret
# 公网部署强烈建议设置；设置后访问者必须先输入此密钥。
APP_ACCESS_KEY=a_long_random_access_key
```

不要提交包含真实密钥的 `.env.local`。`CHECKPOINT_SIGNING_SECRET` 必须与 DashScope API Key 不同；公网部署时还应在 Vercel 设置 `APP_ACCESS_KEY`，并配合 Vercel Firewall 或共享限流服务设置每日额度。

## 2×2 研究实验版

首页已将产品版与实验版完全分流：普通学习功能进入 `/workspace`，本地研究流程进入 `/study/setup`。实验版固定使用仓库内的 `DBI_Relational_Model.pdf`，不显示上传、模式切换、进度或其他与本次实验无关的产品功能。

建议正式实验使用生产构建，并只监听本机：

```bash
npm run build
npm run study
```

打开 [http://localhost:3000](http://localhost:3000)，选择 **Research Study**。研究者输入 `APTT-###`，将 `Prior database experience` 设为 `Novice` 或 `Experienced`，再选择 A/B/C/D 条件并把电脑交给参与者。参与者点击 **Start Learning** 后才开始最长 25 分钟的计时与记录；学习完成后可以二次确认并提前结束。到时或提前结束都会立即锁定交互、保存真实学习时长，随后应先完成 Form 3 Quiz，再完成 Form 2 Post-Learning Questionnaire。

- A：无证据约束、无可核验来源归因
- B：有证据约束、无可核验来源归因
- C：无证据约束、有可核验来源归因
- D：有证据约束、有可核验来源归因
- A/C 使用完全相同的回答核心，B/D 使用完全相同的回答核心；来源归因是各配对条件之间唯一的显示差异。
- B/D 的动态回答采用逐条整句证据认证：无完整课件依据的事实会被删除，认证结果写入两组共享缓存；C/D 对高重合的直接定义提供保守的本地漏引兜底。
- 系统构造的例子会明确标记为假设示例，并使用假设性措辞；未直接来自课件的值、键、域或约束不会被描述为课件事实，也不会获得课件引用。
- 有来源的条件可点击句子级标记，在右侧打开原始 PDF 的对应页并高亮支持文本。
- 参与者可以在固定条件下自由追问；每次回答继续遵守该条件的证据与来源规则。
- 每位参与者的数据独立写入 `~/Desktop/research_record/APTT-###/`。可用 `STUDY_RECORD_ROOT` 更改根目录，用 `STUDY_BUILD_COMMIT` 写入版本标签。
- 正式开始前，系统会检查固定 PDF 哈希、冻结回答包、引用映射、API Key 和记录目录写权限。实验版仅支持 localhost，不应部署到 Vercel。
- 自动回归覆盖概览、详细讲解、生动示例、概念比较和连续追问，并验证 A=C、B=D、引用可见性、课件证据注入和条件盲化。

每次正式实验前，应先执行下方“检查命令”，确认四项检查均通过；不要复用已经生成过记录的 Study ID。

## 当前能力

- 支持 PDF、PPTX，单文件最大 20MB
- 全页 OCR 固定启用，所有 PDF 页面和 PPTX 幻灯片都会进入本机 OCR 管线，不提供绕过选项
- PDF 与 PPTX 共用“页面渲染 → Canvas → Tesseract.js”管线，OCR 文本与原生文字去重合并，并按置信度降权
- 自动检测教学价值较高的图表、表格、流程图和代码截图，裁剪后由 `qwen3-vl-plus` 分析
- 图片来源保留页码、裁剪区域、视觉摘要和缩略图，回答可直接引用并在来源栏核对
- 文件格式、MIME、文件头、解析超时和内容上限校验
- 按页或幻灯片建立结构化分块；分别识别标题、定义、列表、表格与代码
- BM25 关键词检索与 `text-embedding-v4` 语义召回的混合检索
- 多查询改写、BM25、`text-embedding-v4`、RRF 融合和 MMR 去重组成混合召回
- 使用 `qwen3-rerank` 重排序，并综合标题、页码、相邻页、内容类型及 OCR/视觉可靠度
- 对“知识结构、整课概览、详细讲解”等全局问题使用按页全文覆盖，不再用少量 Top-K 片段代替整份课件
- 结构化回答、结论级引用、部分拒答与完全拒答
- 新增“导师教学”模式，按诊断、直觉解释、分步讲解、练习、掌握检查和下一步持续推进
- 深入讲解、课件问答、生成练习、复习总结四种任务模式继续保留
- 测验题目与答案分离，答案按需展开并绑定课件来源
- 可折叠来源栏、引用句高亮、回答反馈与上传失败重试
- PDF / PPTX 逐页 OCR、上传、解析、分块和向量化的真实进度；支持暂停处理、取消上传和停止生成
- IndexedDB 持久化多个课件工作区、索引、视觉证据、对话、反馈、学习模式与掌握程度
- 使用 SHA-256 复用已解析的相同文件，避免重复 OCR、视觉分析和 Embedding 调用
- 上传任务保存原文件、OCR 清单和经服务端独立 HMAC 签名的解析/视觉阶段检查点；页面关闭或网络失败后可继续处理
- 显示跨阶段真实进度、页数、预计剩余时间，以及 OCR/视觉失败的具体页码
- 桌面三栏工作区和移动端文件／学习／引用标签页

当语义嵌入或重排序服务临时不可用时，系统会自动退回本地关键词检索，避免整个学习流程中断。

## 检查命令

```bash
npm test
npm run lint
npm run build
npm run eval
```

## 已知限制

- 全页 OCR 会消耗用户设备的 CPU、内存和电量；长课件在手机或低配置设备上处理较慢。
- OCR 当前使用简体中文和英文模型；复杂公式、低分辨率图表和特殊字体可能识别不准确。
- PDF.js Worker、Tesseract.js Worker/WASM 核心和中英文语言模型均随项目自托管，不依赖第三方 CDN。
- OCR 本身在浏览器本地完成；逐页提取的文字会发送到本项目服务端，并发送到已配置的 DashScope 服务生成 Embedding。候选图表裁剪会发送到视觉模型；提问时，问题、有限对话历史和检索到的课件证据会发送到文本生成与重排序模型。处理敏感、保密或受限制课件前，应确认阿里云账号区域、数据保留政策与所在机构的合规要求。
- “移除课件”会同时删除该课件在当前浏览器中的工作区、全文/向量缓存和未完成处理任务；仓库已忽略浏览器验收快照、评测材料和本地研究文档，避免误提交或部署。
- 学习记录和反馈目前仅保存在本机当前浏览器，尚未跨设备同步，也未接入运营分析后台。
- 浏览器清理站点数据会同时删除本机工作区、缓存和待恢复任务；重要学习记录请勿只保留在单一浏览器中。
- 当前向量索引随文档存储在浏览器中，适合个人多课件学习；大规模共享课件库仍需要服务端向量数据库。
- 已建立 OCR/RAG/图表联合评测脚本与场景权重；10 份真实课件生成的候选题仍需人工审核后才能成为正式金标准。

## 正式评测

评测说明位于 [`evaluation/README.md`](evaluation/README.md)。默认联合夹具运行：

```bash
npm run eval
```

根据真实课件生成候选评测题：

```bash
node --env-file=.env.local scripts/generate-evaluation-dataset.mjs /path/to/lecture1.pdf /path/to/lecture2.pdf
```

生成结果会明确标记为 `pending_human_review`；在人工确认问题、参考答案和相关页码前，不应将其视为正式成绩。
