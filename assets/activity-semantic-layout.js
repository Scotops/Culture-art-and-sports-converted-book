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

  const storage = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // The activity remains usable when storage is unavailable.
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // The activity remains usable when storage is unavailable.
      }
    },
  };

  let nextPageHrefPromise;
  const getNextPageHref = () => {
    if (nextPageHrefPromise) return nextPageHrefPromise;
    nextPageHrefPromise = fetch("./content/pages.json")
      .then((response) => response.ok ? response.json() : [])
      .then((pages) => {
        const sectionId = document.querySelector('meta[name="title-id"]')?.content;
        const index = pages.findIndex((page) => page.section_id === sectionId);
        return index >= 0 && index < pages.length - 1 ? pages[index + 1].href : null;
      })
      .catch(() => null);
    return nextPageHrefPromise;
  };

  const enhancePrintedTaskResponse = ({ card, title, instruction, sourceId }) => {
    if (card.querySelector(`[data-adt-task-response="${sourceId}"]`)) return;
    if (card.closest('section[data-section-type^="activity_"]')) return;
    if (card.querySelector("input, textarea, select, [data-activity-item]")) return;

    const titleText = visibleText(title);
    const isPracticalActivity = /^activity\b/i.test(titleText);
    const pageId = document.querySelector('meta[name="title-id"]')?.content || location.pathname;
    const storageKey = `adt-task-response:${pageId}:${sourceId}`;
    const responseId = `adt-task-answer-${sourceId}`;
    const hintId = `adt-task-hint-${sourceId}`;
    const feedbackId = `adt-task-feedback-${sourceId}`;
    const saved = storage.get(storageKey) || {};
    let hasSubmittedBefore = Boolean(saved.submitted);

    const form = document.createElement("form");
    form.setAttribute("data-adt-task-response", sourceId);
    form.setAttribute("aria-labelledby", title.id);
    if (instruction?.id) addToken(form, "aria-describedby", instruction.id);
    addToken(form, "aria-describedby", hintId);

    const responseField = document.createElement("div");
    responseField.setAttribute("data-adt-task-response-field", "");

    let control;
    if (isPracticalActivity) {
      const label = document.createElement("label");
      label.setAttribute("data-adt-completion-label", "");
      control = document.createElement("input");
      control.type = "checkbox";
      control.id = responseId;
      control.checked = Boolean(saved.value);
      control.setAttribute("data-adt-task-completion", "");
      const labelText = document.createElement("span");
      labelText.textContent = "I completed this activity.";
      label.append(control, labelText);
      responseField.append(label);
    } else {
      const label = document.createElement("label");
      label.htmlFor = responseId;
      label.setAttribute("data-adt-response-label", "");
      label.textContent = "Your response";
      control = document.createElement("textarea");
      control.id = responseId;
      control.rows = 4;
      control.value = typeof saved.value === "string" ? saved.value : "";
      control.placeholder = "Type or describe your response.";
      control.setAttribute("data-adt-task-answer", "");
      responseField.append(label, control);
    }

    control.setAttribute("aria-describedby", `${hintId} ${feedbackId}`);

    const hint = document.createElement("p");
    hint.id = hintId;
    hint.setAttribute("data-adt-task-hint", "");
    hint.textContent = isPracticalActivity
      ? "Complete the activity, select the checkbox, then submit."
      : "Answer in your own words. You can change and submit your response again.";

    const actions = document.createElement("div");
    actions.setAttribute("data-adt-task-actions", "");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.setAttribute("data-adt-task-submit", "");
    submit.textContent = hasSubmittedBefore ? "Update response" : "Submit response";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.setAttribute("data-adt-task-retry", "");
    retry.textContent = "Clear and retry";
    retry.hidden = isPracticalActivity ? !control.checked : !control.value.trim();
    const continueLink = document.createElement("a");
    continueLink.setAttribute("data-adt-task-continue", "");
    continueLink.textContent = "Continue";
    continueLink.hidden = !saved.submitted;
    actions.append(submit, retry, continueLink);

    const feedback = document.createElement("p");
    feedback.id = feedbackId;
    feedback.setAttribute("data-adt-task-feedback", saved.submitted ? "success" : "");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("aria-atomic", "true");
    feedback.tabIndex = -1;
    feedback.textContent = saved.submitted
      ? "Response saved. You can change it and submit again, or continue."
      : "";

    form.append(responseField, hint, actions, feedback);
    card.append(form);

    getNextPageHref().then((href) => {
      if (href) continueLink.href = href;
      else continueLink.remove();
    });

    const currentValue = () => isPracticalActivity ? control.checked : control.value;
    const hasResponse = () => isPracticalActivity ? control.checked : control.value.trim().length > 0;
    const saveDraft = (submitted = false) => storage.set(storageKey, {
      value: currentValue(),
      submitted,
    });

    const handleChange = () => {
      control.removeAttribute("aria-invalid");
      const hasValue = hasResponse();
      retry.hidden = !hasValue;
      continueLink.hidden = true;
      submit.textContent = hasSubmittedBefore ? "Update response" : "Submit response";
      feedback.setAttribute("data-adt-task-feedback", "");
      feedback.textContent = hasSubmittedBefore
        ? "Response changed. Submit again to save your update."
        : "";
      saved.submitted = false;
      saveDraft(false);
    };
    control.addEventListener(isPracticalActivity ? "change" : "input", handleChange);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!hasResponse()) {
        control.setAttribute("aria-invalid", "true");
        feedback.setAttribute("data-adt-task-feedback", "error");
        feedback.textContent = isPracticalActivity
          ? "Select the completion checkbox, then try again."
          : "Enter a response, then try again.";
        control.focus();
        return;
      }
      saved.submitted = true;
      hasSubmittedBefore = true;
      saveDraft(true);
      control.setAttribute("aria-invalid", "false");
      submit.textContent = "Update response";
      feedback.setAttribute("data-adt-task-feedback", "success");
      feedback.textContent = isPracticalActivity
        ? "Activity marked complete. You can change this response or continue."
        : "Response saved. You can change it and submit again, or continue.";
      continueLink.hidden = false;
      feedback.focus({ preventScroll: true });
    });

    retry.addEventListener("click", () => {
      if (isPracticalActivity) control.checked = false;
      else control.value = "";
      saved.submitted = false;
      hasSubmittedBefore = false;
      storage.remove(storageKey);
      control.removeAttribute("aria-invalid");
      submit.textContent = "Submit response";
      retry.hidden = true;
      continueLink.hidden = true;
      feedback.setAttribute("data-adt-task-feedback", "");
      feedback.textContent = "Response cleared. Try again.";
      control.focus();
    });
  };

  const enhanceNativeEditPath = (section) => {
    if (section.querySelector("[data-adt-native-edit]")) return;
    const inputs = [...section.querySelectorAll('input[type="text"][data-activity-item], textarea[data-activity-item]')];
    if (!inputs.length) return;

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-adt-native-edit", "");
    wrapper.hidden = true;
    const note = document.createElement("p");
    note.textContent = "Answers saved. Change your responses to edit and submit again, or select Next to continue.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Change responses";
    wrapper.append(note, button);
    section.append(wrapper);

    const editFocusKey = `adt-native-edit-focus:${location.pathname}`;
    if (sessionStorage.getItem(editFocusKey) === "true") {
      sessionStorage.removeItem(editFocusKey);
      setTimeout(() => inputs[0]?.focus({ preventScroll: true }), 400);
    }

    const updateVisibility = () => {
      const nextButton = [...document.querySelectorAll("button")].find((candidate) =>
        /^next$/i.test(visibleText(candidate))
      );
      wrapper.hidden = !nextButton;
    };
    const observer = new MutationObserver(updateVisibility);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    updateVisibility();

    button.addEventListener("click", () => {
      sessionStorage.setItem(editFocusKey, "true");
      location.reload();
    });
  };

  const initializeNavigationSemantics = () => {
    let scheduled = false;
    const apply = () => {
      scheduled = false;
      document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
        if (dialog.hasAttribute("aria-label") || dialog.hasAttribute("aria-labelledby")) return;
        const buttonLabels = [...dialog.querySelectorAll("button")].map(visibleText);
        if (buttonLabels.includes("Contents") && buttonLabels.includes("Page list")) {
          dialog.setAttribute("aria-label", "Book navigation");
        }
      });

      const readerControls = document.querySelector('[role="group"][aria-label="Reader controls"]');
      const nextButton = readerControls?.querySelector('button[aria-label="Next page"]');
      const pageNav = nextButton?.parentElement;
      const pageCount = [...(pageNav?.querySelectorAll("div") || [])].find((element) =>
        /^\s*\d+\s*\/\s*\d+\s*$/.test(visibleText(element))
      );
      if (pageCount) {
        const match = visibleText(pageCount).match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          pageCount.setAttribute("role", "status");
          pageCount.setAttribute("aria-live", "polite");
          pageCount.setAttribute("aria-label", `Page ${match[1]} of ${match[2]}`);
        }
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(apply);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
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

      enhancePrintedTaskResponse({ card, title, instruction, sourceId });
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

      enhanceNativeEditPath(section);
    });

    enhancePrintedGlossary(content);
    initializeGlossaryFocus();
    initializeNavigationSemantics();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
