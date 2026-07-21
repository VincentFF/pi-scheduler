# 🤖 pi-scheduler：给你的 AI 编程助手加个定时任务

你是否遇到过这些场景？

😤 token 用完了，等半小时重置，结果忘记回来继续
😴 每天早上想让 pi 自动总结昨天的代码改动
⏰ 想定时让 pi 帮你检查服务器状态

**pi-scheduler** 就是为这些场景而生的！

---

## ✨ 核心亮点

- 🔧 **不依赖 AI 解析**：用正则匹配指令，token 耗尽照样配置
- 📝 **两种配置方式**：命令行 `/schedule add` 或直接改 JSON 文件
- ⏱️ **灵活定时**：一次性 / 每天 / 每小时 / 固定间隔 / 每周

---

## 🚀 安装只需一行

```bash
pi install npm:@vincentff/pi-scheduler
```

---

## 📋 使用示例

```bash
# 一小时后自动重试
/schedule add in 1h | 继续review auth模块

# 每天早上9点简报
/schedule add daily 09:00 | 总结昨天的改动

# 查看所有任务
/schedule list
```

---

## 🔗 仓库地址

GitHub：github.com/VincentFF/pi-scheduler

欢迎 Star ⭐ 和 PR 🙏

---

#pi #AIAgent #开发工具 #效率工具 #开源 #程序员 #定时任务
