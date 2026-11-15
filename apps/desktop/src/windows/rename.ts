// 重命名对话框：回车提交，ESC 取消，结果交给打开它的窗口处理。
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const params = new URLSearchParams(location.search);
const input = document.querySelector<HTMLInputElement>("#name");
const currentWindow = getCurrentWindow();

if (input) {
  input.value = params.get("name") ?? "";
}

function submit() {
  void emit("rename:submit", input?.value ?? "");
}

function cancel() {
  void emit("rename:cancel");
}

document.querySelector("#ok")?.addEventListener("click", submit);
document.querySelector("#cancel")?.addEventListener("click", cancel);

input?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  }
});

// 点到别处等同取消，窗口由发起方关闭
let focused = false;
void currentWindow.onFocusChanged(({ payload }) => {
  if (payload) {
    focused = true;
  } else if (focused) {
    cancel();
  }
});

input?.focus();
input?.select();
