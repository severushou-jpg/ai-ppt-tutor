# 真实课件评测复核指南

`datasets/real-lectures-v1.json` 是由模型基于课件片段生成的候选集，不能直接当作最终金标准。提交正式基线前，请完成下面的人工复核。

## 每道题必须检查

1. 问题自然、明确，且符合 `overview / detail / visual / review / comparison / unanswerable` 场景。
2. `referenceAnswer` 只包含课件能够支持的事实。
3. `relevantChunkIds` 覆盖回答所需的全部证据，不只是一条碰巧相关的片段。
4. `visual` 题确实依赖代码、表格、图、公式或图片；同时核对裁剪图片和页码。
5. `unanswerable` 题与课程相关，但课件确实没有答案，并保持 `shouldRefuse: true`。
6. 通过后将 `reviewStatus` 改为 `approved`；有问题则改为 `rejected` 并修订或删除。

## OCR 人工真值

从自动 OCR 页中按低、中、高置信度各抽样至少 10 页。对每页人工转写 2–5 行关键文字，写入数据集的 `ocrSamples`：

```json
{
  "documentId": "...",
  "page": 7,
  "expected": "人工转写文本",
  "actual": "OCR 输出文本"
}
```

不要用另一个 OCR 服务的输出充当人工真值。

## 建议验收门槛

- 检索 Recall@10 ≥ 0.85
- MRR ≥ 0.75
- OCR 字符准确率 ≥ 0.90
- 引用正确率 ≥ 0.95
- 应拒答准确率 ≥ 0.90
- 五类核心场景中任一类别不得低于 0.75

每次修改分块、检索、重排序、Prompt 或视觉处理后，都应在同一份已批准数据集上重新运行并保存报告，避免只凭个别演示判断质量。
