// The question card (D-381): everything visible at rest, the recommended option first and marked, number keys for the first four.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QuestionCard as Question } from "../../src/api/http.ts";
import { QuestionCard } from "../../src/web/chat/QuestionCard.tsx";
import { optionForKey } from "../../src/web/chat/question-keys.ts";

const question: Question = {
  toolUseId: "t1", question: "Replace the config on your keyboard, or add this one beside it?",
  options: [{ label: "Add it as a new config", description: "The current one stays." }, { label: "Replace the current config" }], allowOther: true, answer: null,
};
const render = (q: Question, disabled = false) => renderToStaticMarkup(createElement(QuestionCard, { question: q, disabled, onAnswer: () => {} }));

describe("QuestionCard", () => {
  test("an open question shows every option as a button, the first marked recommended, and Something else when allowed", () => {
    const html = render(question);
    expect(html).toContain("Add it as a new config");
    expect(html).toContain("Replace the current config");
    expect(html).toContain("The current one stays.");
    expect(html.match(/Recommended/g)).toHaveLength(1);
    expect(html.indexOf("Recommended")).toBeLessThan(html.indexOf("Replace the current config"));
    expect(html).toContain("Something else…");
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('tabindex="0"');
  });

  test("without allowOther there is no free-text way out, and a busy reply disables the buttons", () => {
    const html = render({ ...question, allowOther: false }, true);
    expect(html).not.toContain("Something else");
    expect(html).toContain("disabled");
  });

  test("an answered question is a quiet read-only line with the answer and no buttons", () => {
    const html = render({ ...question, answer: "Add it as a new config" });
    expect(html).toContain("ask-card-done");
    expect(html).toContain("Add it as a new config");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Recommended");
  });

  test("number keys 1 to 4 pick the option in that place, and nothing else does", () => {
    const options = ["a", "b", "c", "d"];
    expect(["1", "2", "3", "4"].map((k) => optionForKey(k, options))).toEqual(options);
    expect(optionForKey("5", options)).toBeUndefined();
    expect(optionForKey("0", options)).toBeUndefined();
    expect(optionForKey("3", ["a", "b"])).toBeUndefined();
    expect(optionForKey("a", options)).toBeUndefined();
  });

  test("multiple_choice renders checkboxes and submit button", () => {
    const multiQ: Question = {
      toolUseId: "t2",
      kind: "multiple_choice",
      question: "Which of these keyboards should receive the macro?",
      options: [
        { id: "glove80", label: "Glove80" },
        { id: "moonlander", label: "Moonlander" },
      ],
      allowOther: false,
      answer: null,
    };
    const html = render(multiQ);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Glove80");
    expect(html).toContain("Moonlander");
    expect(html).toContain("Submit choice");
  });

  test("short_text renders input field with placeholder and submit button", () => {
    const textQ: Question = {
      toolUseId: "t3",
      kind: "short_text",
      question: "What should this config be called?",
      options: [],
      placeholder: "e.g. Colemak Daily",
      allowOther: false,
      answer: null,
    };
    const html = render(textQ);
    expect(html).toContain('placeholder="e.g. Colemak Daily"');
    expect(html).toContain("Send");
  });

  test("layer renders layer chips", () => {
    const layerQ: Question = {
      toolUseId: "t4",
      kind: "layer",
      question: "Which layer should receive Navigation?",
      options: [
        { id: "lay_0", label: "Base" },
        { id: "lay_1", label: "Nav" },
      ],
      allowOther: false,
      answer: null,
    };
    const html = render(layerQ);
    expect(html).toContain("ask-layer-chip");
    expect(html).toContain("Base");
    expect(html).toContain("Nav");
  });

  test("keyboard_or_config renders keyboard options with recommended flag", () => {
    const kbQ: Question = {
      toolUseId: "t5",
      kind: "keyboard_or_config",
      question: "Which keyboard did you mean?",
      options: [
        { id: "glove80", label: "Glove80", recommended: false },
        { id: "moonlander", label: "Moonlander", recommended: true },
      ],
      allowOther: false,
      answer: null,
    };
    const html = render(kbQ);
    expect(html).toContain("Glove80");
    expect(html).toContain("Moonlander");
    expect(html).toContain("Recommended");
  });

  test("key question renders instruction and options", () => {
    const keyQ: Question = {
      toolUseId: "t6",
      kind: "key",
      question: "Where should this layer key go?",
      options: [
        { id: "pos_24", label: "Key 24 (Thumb)" },
        { id: "pos_25", label: "Key 25" },
      ],
      allowOther: false,
      answer: null,
    };
    const html = render(keyQ);
    expect(html).toContain("Click a key on the board");
    expect(html).toContain("Key 24 (Thumb)");
  });
});
