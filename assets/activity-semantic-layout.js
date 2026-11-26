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

  const initializeGlossaryFocus = () => {
    let lastTrigger = null;
    let glossaryDialogWasOpen = false;
    const dialogSelector = '[role="dialog"][aria-label^="Definition for "]';

    const restoreTriggerFocus = () => {
      if (!lastTrigger?.isConnected) return;
      requestAnimationFrame(() => lastTrigger?.focus({ preventScroll: true }));
    };

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest?.(".glossary-term[data-glossary-key]");
      if (trigger) lastTrigger = trigger;
    }, true);

    document.addEventListener("keydown", (event) => {
      const trigger = event.target.closest?.(".glossary-term[data-glossary-key]");
      if (trigger && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        lastTrigger = trigger;
        trigger.click();
      }
      if (event.key === "Escape" && glossaryDialogWasOpen) {
        setTimeout(() => {
          if (!document.querySelector(dialogSelector)) restoreTriggerFocus();
        }, 0);
      }
    });

    const observer = new MutationObserver(() => {
      const glossaryDialogIsOpen = Boolean(document.querySelector(dialogSelector));
      if (glossaryDialogWasOpen && !glossaryDialogIsOpen) restoreTriggerFocus();
      glossaryDialogWasOpen = glossaryDialogIsOpen;
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const enhancePrintedGlossary = (content) => {
    if (!content.querySelector('[data-section-id="pg103_sec001"]')) return;

    const entries = [
      {
        term: "msuli",
        termId: "pg103_n0004",
        definitionId: "pg103_n0005",
        imageId: "pg014_im003",
        src: "images/pg014_im003.jpg",
        alt: "Man wearing a yellow msuli with a coat and T-shirt.",
      },
      {
        term: "batik",
        termId: "pg103_n0007",
        definitionId: "pg103_n0008",
        imageId: "pg014_im001",
        src: "images/pg014_im001.jpg",
        alt: "Child wearing a blue and purple batik gown.",
      },
      {
        term: "kaniki",
        termId: "pg103_n0010",
        definitionId: "pg103_n0011",
        imageId: "pg015_im001",
        src: "images/pg015_im001.jpg",
        alt: "Woman wearing a black kaniki chest wrap.",
      },
      {
        term: "referee",
        termId: "pg103_n0013",
        definitionId: "pg103_n0014",
      },
    ];

    entries.forEach((entry) => {
      const term = content.querySelector(`[data-id="${entry.termId}"]`);
      const definition = content.querySelector(`[data-id="${entry.definitionId}"]`);
      const row = definition?.parentElement;
      if (!term || !definition || !row) return;

      term.id ||= `glossary-term-${entry.term}`;
      definition.id ||= `glossary-definition-${entry.term}`;
      row.id = `glossary-entry-${entry.term}`;
      row.setAttribute("data-adt-glossary-entry", entry.term);
      row.setAttribute("role", "group");
      row.setAttribute("aria-labelledby", term.id);
      row.setAttribute("aria-describedby", definition.id);

      if (!entry.src || row.querySelector("[data-adt-glossary-visual]")) return;
      const figure = document.createElement("figure");
      figure.setAttribute("data-adt-glossary-visual", "");
      const image = document.createElement("img");
      image.src = entry.src;
      image.alt = entry.alt;
      image.loading = "lazy";
      image.setAttribute("data-id", entry.imageId);
      image.setAttribute("data-adt-glossary-visual-image", "");
      figure.appendChild(image);
      row.appendChild(figure);
    });
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

    enhancePrintedGlossary(content);
    initializeGlossaryFocus();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
