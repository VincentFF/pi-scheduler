# pi-scheduler

[English](README.md)

使用**固定格式模板**为 pi 设置定时任务。支持一次性任务和周期性任务，全程正则解析，不依赖 AI，因此即使 token 配额耗尽也能正常工作。

## 为什么选择 pi-scheduler？

- **不依赖 AI**：所有调度解析使用正则表达式，而非 AI。即使被限流或 token 耗尽，依然可以配置定时任务。
- **两种配置方式**：通过 `/schedule add` 交互式添加，或直接编辑 JSON 配置文件。
- **灵活的定时规则**：支持一次性（绝对时间 / 相对延迟）、每日、每小时、固定间隔、每周。

## 安装

```bash
pi install npm:@vincentff/pi-scheduler
```

本地开发：

```bash
pi install ./path/to/pi-scheduler
```

## 模板格式

```
<调度规则> | <提示词>
```

### 一次性任务

| 模板 | 示例 |
|----------|---------|
| `at YYYY-MM-DD HH:mm` | `at 2025-12-31 23:59 \| 新年快乐！` |
| `in Ns` / `Nm` / `Nh` / `Nd` | `in 30m \| 检查服务器状态` |

### 周期性任务

| 模板 | 示例 |
|----------|---------|
| `daily HH:mm` | `daily 09:00 \| 早安，来个今日摘要` |
| `hourly` | `hourly \| 健康检查` |
| `every Ns/Nm/Nh/Nd` | `every 2h \| 检查长时间运行的任务` |
| `weekly DAY HH:mm` | `weekly mon 09:00 \| 周计划` |

星期缩写：`mon`、`tue`、`wed`、`thu`、`fri`、`sat`、`sun`

## 使用案例

### 案例 1：Token 配额重置后自动重试

你触发了速率限制，但配额将在 45 分钟后重置。让 pi 到时间自动重试：

```
/schedule add in 45m | 重试我上次的请求：review auth 模块的重构
```

定时器触发后，pi 会将 prompt 作为用户消息发送——就像你亲手输入一样。你可以暂时离开，回来直接看结果。

### 案例 2：每日早间简报

设置一个周期性任务，让每个工作日自动启动：

```
/schedule add daily 09:00 | 早上好！查看我从昨天以来的 git 历史，总结我做了什么，并建议今天的前 3 个优先事项。
```

也可以在配置文件中批量配置，实现完整的日常流程：

```json
{
  "tasks": [
    {
      "id": "morning-brief",
      "schedule": "daily 09:00",
      "prompt": "总结仓库最近的改动，并建议今天的优先事项",
      "enabled": true,
      "createdAt": "2025-07-21T00:00:00.000Z"
    },
    {
      "id": "afternoon-check",
      "schedule": "daily 14:00",
      "prompt": "查看待处理的 issue，提醒我有哪些未完成的 code review",
      "enabled": true,
      "createdAt": "2025-07-21T00:00:00.000Z"
    }
  ],
  "paused": false
}
```

## 命令

| 命令 | 说明 |
|---------|-------------|
| `/schedule add <模板>` | 添加定时任务 |
| `/schedule list` | 列出所有任务及下次执行时间 |
| `/schedule remove <id>` | 删除任务（支持 ID 前缀匹配） |
| `/schedule toggle <id>` | 启用/禁用某个任务 |
| `/schedule pause` | 暂停所有调度 |
| `/schedule resume` | 恢复所有调度 |
| `/schedule clear` | 清除所有任务 |
| `/schedule help` | 显示模板参考 |

## 配置文件

任务以 JSON 格式存储，可直接编辑进行批量修改：

**全局：** `~/.pi/agent/scheduler-tasks.json`
**项目：** `.pi/scheduler-tasks.json`（优先级更高）

```json
{
  "tasks": [
    {
      "id": "a1b2c3d4-...",
      "schedule": "daily 09:00",
      "prompt": "总结今天的待办事项",
      "enabled": true,
      "createdAt": "2025-01-15T08:00:00.000Z"
    },
    {
      "id": "e5f6g7h8-...",
      "schedule": "in 30m",
      "prompt": "检查构建状态",
      "enabled": true,
      "createdAt": "2025-01-15T09:00:00.000Z"
    }
  ],
  "paused": false
}
```

## License

MIT
