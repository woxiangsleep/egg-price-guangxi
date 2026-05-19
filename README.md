# 广西鸡蛋价格

这是一个 Android 优先的 Expo 手机应用，用来查看广西鸡蛋每日参考价格。

## 数据来源

- 公众号：鸡蛋报价早知道
- 搜索格式：`M月D日广西鸡蛋价格`
- GitHub Actions 每天下午 2 点（北京时间）自动运行一次采集脚本
- 采集结果写入：
  - `public/data/prices.json`
  - `docs/data/prices.json`

## 本地运行

```bash
npm install
npm run start
```

## 手动更新数据

```bash
npm run update:data:sogou
```

## 验证

```bash
npm run typecheck
```
