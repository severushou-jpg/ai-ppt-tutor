# AI PPT Tutor 正式评测体系

评测权重按照当前产品优先级固定为：整课概览 30%、知识点详解 25%、代码/表格/图表 20%、复习总结 15%、概念比较 10%。

`npm run eval` 会运行离线检索基线并输出不入库的 `evaluation/reports/offline-latest.json`；`node --env-file=.env.local scripts/evaluate.mjs evaluation/datasets/real-lectures-v1.json --online` 会加入真实 Embedding 和 Reranker，并更新 `evaluation/reports/latest.json`。每题至少填写 `category`、`question`、`mode` 和 `relevantChunkIds`；无法从课件回答的问题还需标注 `shouldRefuse: true`。

10 份课件的候选集可用下面的命令重新生成：

```bash
node --env-file=.env.local scripts/generate-evaluation-dataset.mjs <pdf...>
```

模型生成的题目不是金标准，正式使用前必须按照 `HUMAN_REVIEW_GUIDE.md` 复核。

发布门槛分三层：

- 检索：Recall@10 ≥ 0.85、MRR ≥ 0.75、NDCG@10 按场景持续上升。
- 证据：引用页码正确率 ≥ 0.95、无依据结论率 ≤ 0.03、拒答准确率 ≥ 0.90。
- 教学：人工评分覆盖正确性、完整性、解释清晰度、难度适配和学习帮助度；每项使用 1–5 分，核心场景平均不得低于 4 分。

10 份真实课件建议每份审核 8–12 题，总规模 80–120 题。题目按简单事实、跨页综合、视觉理解、对比推理和不可回答五类分层，并保留每次发布的报告以检查回归。
