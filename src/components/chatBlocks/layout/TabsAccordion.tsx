import { useState } from "react";

import type { AccordionBlock, TabsBlock } from "../../../lib/chatBlocks/types";
import { RenderBlock } from "../RenderBlock";

export function TabsBlockView({ block }: { block: TabsBlock }) {
  const defaultId = block.defaultTab ?? block.tabs[0]?.id ?? "";
  const [active, setActive] = useState(defaultId);
  const current = block.tabs.find((t) => t.id === active) ?? block.tabs[0];

  return (
    <div className="chat-layout-tabs">
      <div className="chat-layout-tabs-head" role="tablist">
        {block.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className={`chat-layout-tab${tab.id === active ? " chat-layout-tab-active" : ""}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current ? (
        <div className="chat-layout-tabs-panel" role="tabpanel">
          {current.children.map((child, i) => (
            <RenderBlock key={i} block={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AccordionBlockView({ block }: { block: AccordionBlock }) {
  const initialOpen = new Set(
    block.items.filter((item) => item.defaultOpen).map((item) => item.id),
  );
  if (!initialOpen.size && block.items[0]) initialOpen.add(block.items[0].id);

  const [openIds, setOpenIds] = useState<Set<string>>(initialOpen);

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="chat-layout-accordion">
      {block.items.map((item) => {
        const isOpen = openIds.has(item.id);
        return (
          <div key={item.id} className={`chat-layout-accordion-item${isOpen ? " chat-layout-accordion-open" : ""}`}>
            <button
              type="button"
              className="chat-layout-accordion-trigger"
              aria-expanded={isOpen}
              onClick={() => toggle(item.id)}
            >
              <span>{item.title}</span>
              <span className="chat-layout-accordion-chevron" aria-hidden>
                {isOpen ? "−" : "+"}
              </span>
            </button>
            {isOpen ? (
              <div className="chat-layout-accordion-panel">
                {item.children.map((child, i) => (
                  <RenderBlock key={i} block={child} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
