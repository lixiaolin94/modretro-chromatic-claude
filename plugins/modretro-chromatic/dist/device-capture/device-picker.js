/// <reference lib="dom" />
/** An in-page picker avoids platform menus appearing away from the field in embedded views. */
export function mountDevicePicker(root, onSelect) {
    const trigger = root.querySelector("#device-picker-trigger");
    const value = root.querySelector("#device-picker-value");
    const list = root.querySelector("#device-picker-list");
    let choices = [], selected = "", key = "";
    const close = (restore = false) => {
        list.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        if (restore)
            trigger.focus();
    };
    const optionNodes = () => Array.from(list.querySelectorAll("[role=option]"));
    const open = () => {
        if (trigger.disabled || !choices.length)
            return;
        list.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        (optionNodes().find(node => node.dataset.id === selected) ?? optionNodes()[0])?.focus();
    };
    trigger.addEventListener("click", () => list.hidden ? open() : close());
    trigger.addEventListener("keydown", event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            open();
        }
    });
    list.addEventListener("keydown", event => {
        const nodes = optionNodes(), current = nodes.indexOf(event.target);
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
            return;
        }
        if (event.key === "Tab") {
            close();
            return;
        }
        const next = event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1
            : event.key === "ArrowDown" ? Math.min(nodes.length - 1, current + 1)
                : event.key === "ArrowUp" ? Math.max(0, current - 1) : -1;
        if (next >= 0) {
            event.preventDefault();
            nodes[next]?.focus();
        }
    });
    const outside = (event) => {
        const path = event.composedPath();
        if (!path.includes(trigger) && !path.includes(list))
            close();
    };
    root.addEventListener("pointerdown", outside);
    return {
        render(next, id, disabled, single) {
            choices = next;
            selected = id;
            trigger.hidden = single;
            trigger.disabled = disabled;
            const label = next.find(item => item.deviceId === id)?.label ?? "Select device";
            if (value.textContent !== label)
                value.textContent = label;
            const nextKey = JSON.stringify(next.map(item => [item.deviceId, item.label]));
            if (key !== nextKey) {
                key = nextKey;
                list.replaceChildren(...next.map(item => {
                    const option = trigger.ownerDocument.createElement("button");
                    option.type = "button";
                    option.setAttribute("role", "option");
                    option.tabIndex = -1;
                    option.setAttribute("aria-selected", String(item.deviceId === id));
                    option.dataset.id = item.deviceId;
                    option.textContent = item.label;
                    option.addEventListener("click", () => { onSelect(item.deviceId); close(true); });
                    return option;
                }));
            }
            for (const option of optionNodes()) {
                const isSelected = String(option.dataset.id === id);
                if (option.getAttribute("aria-selected") !== isSelected)
                    option.setAttribute("aria-selected", isSelected);
            }
            if (disabled || single)
                close();
        },
        close,
        dispose() { root.removeEventListener("pointerdown", outside); },
    };
}
//# sourceMappingURL=device-picker.js.map