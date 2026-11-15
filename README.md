# model-router

Mod cho Claude Code. Mod phân loại mỗi prompt là **easy**, **normal** hoặc **hard**, ghi số token của từng request vào log, và có thể chỉnh **effort** hoặc **model** theo từng loại.

## Cài đặt

Cần Claude Code từ bản 2.1.325 (`claude update`). Trong một phiên Claude Code ở terminal, gõ:

```
/plugin install model-router --marketplace trungdongdblue/model-router
```

Hoặc từ shell:

```bash
claude plugin install model-router --marketplace trungdongdblue/model-router
```

Trả lời `y` để thêm marketplace, chọn scope `user` (mọi phiên), rồi đặt tùy chọn ở màn hình tiếp theo. Mặc định là `mode: log`, tức chỉ ghi log; chọn `route` để mod chọn model và effort thật. Sau này đổi tùy chọn trong `/config`.

Trong desktop app (không có `/plugin`): bấm + cạnh ô nhập → Plugins → Add marketplace với `trungdongdblue/model-router` → Add plugin.

Trong khung chat Claude của VS Code, mod đổi model ngầm theo từng request: ô chọn model của VS Code vẫn hiện model gốc, còn dòng trạng thái `router: …` cho biết model thật.

Log ghi tại `logs/<thời-điểm>.jsonl` trong thư mục plugin, mỗi phiên một file.

## Chạy thử từ mã nguồn (không cài)

```bash
git clone git@github.com:trungdongdblue/model-router.git
claude --plugin-dir ./model-router \
  --settings '{"pluginConfigs":{"model-router":{"options":{"mode":"route"}}}}'
```

## Tùy chọn

| Tùy chọn | Mặc định | Ý nghĩa |
|---|---|---|
| `mode` | `log` | `log`: chỉ ghi log. `route`: áp dụng đòn bẩy |
| `lever` | `both` | `both`: model chọn 1 lần theo prompt đầu của session, effort theo từng prompt. `effort`: chỉ effort. `model`: chỉ model |
| `switchStyle` | `visible` | `visible`: đổi dòng Model trong `/config`, nên `/model` và footer hiện đúng model đang chạy. Setting đã lưu của bạn không bị đổi. `silent`: không đụng vào setting, chỉ ghi đè model trên từng request. Session không có giao diện (`claude -p`) luôn dùng `silent` |
| `easyEffort` / `hardEffort` | `low` / `xhigh` | Effort cho prompt dễ / khó |
| `easyModel` / `normalModel` / `hardModel` | `haiku` / *(rỗng)* / *(rỗng)* | Model của session theo loại prompt đầu. Để rỗng nghĩa là dùng model gốc của bạn (ví dụ `opus[1m]`) |
| `switchTurns` | `1` | Model đi theo prompt chỉ trong N prompt đầu, sau đó giữ nguyên để không mất cache |
| `escalate` | `true` | Session bắt đầu bằng model nhẹ sẽ được nâng lên khi gặp prompt khó hơn. Không bao giờ hạ xuống |

## Chuyển model hiển thị (`visible`)

- Mod đổi dòng Model trong `/config`, nên `/model` và footer hiện đúng model đang chạy.
- Ngay sau đó, mod **ghi trả file `~/.claude/settings.json` về nguyên trạng**. Session vẫn giữ model mới, còn setting đã lưu của bạn không bao giờ bị đổi. Vì vậy thoát bằng cách nào cũng không bị kẹt, kể cả Ctrl+C. Điều này đã được test thật.
- Phương án dự phòng, chỉ dùng khi đúng lúc đó file có thay đổi khác chen vào: mod ghi lại việc cần khôi phục vào bộ nhớ riêng, rồi trả model gốc khi bạn `/exit` hoặc `/clear`, hoặc ở prompt đầu của session sau.

## Luật phân loại

Luật nằm trong `hooks/classify.ts`. Mỗi luật ghi nguồn tham khảo của nó. Mặc định là `normal`, tức không can thiệp. Tín hiệu khó luôn thắng tín hiệu dễ.

- **hard**:
  - refactor hoặc migration (Anthropic: choosing a model)
  - kiến trúc hoặc thiết kế (Claude Code docs: costs)
  - lập kế hoạch (opusplan)
  - debug mơ hồ như root cause, flaky, race (bài của Anthropic về model và effort)
  - phạm vi rộng nhiều file (SWE-bench-Live: tỉ lệ giải được dưới 10% khi sửa từ 3 file trở lên)
  - prompt dài trên 8000 ký tự (route longContext của claude-code-router)
- **easy**:
  - prompt dưới 200 ký tự
  - không có stack trace hay code block
  - là một sửa đổi máy móc (đổi tên, typo, format, comment) hoặc một câu hỏi nhanh (Claude Code docs: model config)
- **xã giao** (chỉ chào, cảm ơn, "ok"): không dùng để chọn model và không đổi effort. Phiên chờ câu có việc thật đầu tiên mới chọn model.

## Kiểm tra

```bash
claude plugin validate .
claude plugin test .
```

Muốn tắt mọi mod trong một phiên: chạy `claude --safe-mode`.
