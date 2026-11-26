/* Normalize activity semantics without changing the textbook wording or artwork. */
(() => {
  const TASK_TITLE = /^(activity|exercise)\b/i;

  const addToken = (element, attribute, token) => {
    const tokens = new Set((element.getAttribute(attribute) || "").split(/\s+/).filter(Boolean));
    tokens.add(token);
    element.setAttribute(attribute, [...tokens].join(" "));
  };

  const visibleText = (element) => {
    if (!element || element.closest(".sr-only")) return "";
    return (element.textContent || "").replace(/\s+/g, " ").trim();
  };

  const findTaskCard = (title, section) => {
    let candidate = title.parentElement;
    while (candidate && candidate !== section) {
      const hasInstruction = [...candidate.querySelectorAll("[data-id]")].some((element) => {
        const text = visibleText(element);
        return element !== title && text && !TASK_TITLE.test(text);
      });
      if (hasInstruction) return candidate;
      candidate = candidate.parentElement;
    }
    return section;
  };

  const initialize = () => {
    const content = document.getElementById("content");
    if (!content) return;

    const titles = [...content.querySelectorAll("[data-id]")].filter((element) =>
      TASK_TITLE.test(visibleText(element))
    );

    titles.forEach((title, index) => {
      const section = title.closest("section");
      if (!section) return;

      const sourceId = title.getAttribute("data-id") || `${section.dataset.sectionId || "task"}-${index + 1}`;
      const titleId = title.id || `adt-task-title-${sourceId}`;
      title.id = titleId;
      title.setAttribute("data-adt-task-title", "");
      if (!/^H[1-6]$/.test(title.tagName)) {
        title.setAttribute("role", "heading");
        title.setAttribute("aria-level", "2");
      }

      const card = findTaskCard(title, section);
      const headingWrapper = title.parentElement !== card &&
        title.parentElement?.querySelectorAll("[data-id]").length === 1
        ? title.parentElement
        : title;
      headingWrapper?.setAttribute("data-adt-task-heading", "");

      section.setAttribute("data-adt-activity-section", "");
      card.setAttribute("data-adt-task-card", "");
      if (!card.hasAttribute("role")) card.setAttribute("role", "group");
      addToken(card, "aria-labelledby", titleId);

      const textElements = [...card.querySelectorAll("[data-id]")].filter((element) => visibleText(element));
      const titlePosition = textElements.indexOf(title);
      const instruction = textElements.slice(Math.max(0, titlePosition + 1)).find((element) =>
        !TASK_TITLE.test(visibleText(element))
      );

      if (instruction) {
        const instructionSourceId = instruction.getAttribute("data-id") || `${sourceId}-instruction`;
        const instructionId = instruction.id || `adt-task-instruction-${instructionSourceId}`;
        instruction.id = instructionId;
        instruction.setAttribute("data-adt-task-instruction", "");
        addToken(card, "aria-describedby", instructionId);
      }

      card.querySelectorAll("p[data-id], li[data-id], div[data-id]").forEach((element) => {
        if (element !== title) element.setAttribute("data-adt-task-copy", "");
      });

      card.querySelectorAll("img:not(.sr-only), figure, video").forEach((element) => {
        if (element.getAttribute("aria-hidden") === "true") return;
        const position = getComputedStyle(element).position;
        if (position === "static" || position === "relative") {
          element.setAttribute("data-adt-task-media", "");
        }
      });
    });

    content.querySelectorAll('section[data-section-type="activity_open_ended_answer"]').forEach((section) => {
      const title = section.querySelector("[data-adt-task-title]");
      const instruction = section.querySelector("[data-adt-task-instruction]");
      if (title) addToken(section, "aria-labelledby", title.id);
      if (instruction) addToken(section, "aria-describedby", instruction.id);

      section.querySelectorAll('input[type="text"][data-activity-item], textarea[data-activity-item]').forEach((input) => {
        input.setAttribute("data-adt-response-control", "");
        if (instruction) addToken(input, "aria-describedby", instruction.id);
      });
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
