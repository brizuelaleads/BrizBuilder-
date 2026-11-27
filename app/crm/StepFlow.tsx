"use client";

// A pop-up form shown one question at a time, ending on a review card.
//
// Every step stays mounted and only the current one is visible, so a form's
// fields keep their values when someone moves back and forth, and the save
// handler can still read everything with FormData as the one-screen forms did.
// The form is noValidate: each step's fields are checked when moving on, and
// a final submit jumps to the first step with a problem.

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, Pencil } from "lucide-react";
import { Modal } from "./ui";

export type FlowReviewRow = { label: string; value: string };

export type FlowStep = {
  id: string;
  /** Short name in the progress bar, e.g. "Who". */
  label: string;
  /** The question at the top of the step, e.g. "Who is the lead?". */
  question: string;
  /** What the progress bar shows once the step has an answer. */
  summary?: (form: FormData) => string;
  /** Rows for the review card. Empty values are left out. */
  review?: (form: FormData) => FlowReviewRow[];
  /** Leave the step out entirely (for example a business picker with one business). */
  skip?: boolean;
  content: ReactNode;
};

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function fieldsIn(section: Element | null): Field[] {
  if (!section) return [];
  return Array.from(section.querySelectorAll<Field>("input, select, textarea")).filter(
    (field) => field.willValidate,
  );
}

export function StepFlow({
  title,
  eyebrow,
  wide = false,
  onClose,
  steps,
  submitLabel,
  busy,
  onSubmit,
  reviewQuestion = "Look it over",
  reviewExtra,
  error,
}: {
  title: string;
  eyebrow?: string;
  wide?: boolean;
  onClose: () => void;
  steps: FlowStep[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (form: FormData) => void;
  reviewQuestion?: string;
  /** Anything to show under the review card, such as an import preview. */
  reviewExtra?: ReactNode;
  error?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const visible = steps.filter((step) => !step.skip);
  const reviewIndex = visible.length;
  const [current, setStep] = useState(0);
  // A copy of the form's values, refreshed on every edit and step change, so
  // the progress bar and review card show what has been entered.
  const [form, setForm] = useState<FormData | null>(null);

  function refresh() {
    if (formRef.current) setForm(new FormData(formRef.current));
  }

  function setCurrent(index: number) {
    refresh();
    setStep(index);
  }

  // After jumping to a step with a problem, point at the field once it shows.
  function reportOn(index: number) {
    setCurrent(index);
    window.requestAnimationFrame(() => {
      fieldsIn(sectionRefs.current[index]).find((field) => !field.checkValidity())?.reportValidity();
    });
  }

  function stepIsValid(index: number) {
    return fieldsIn(sectionRefs.current[index]).every((field) => field.checkValidity());
  }

  function goTo(index: number) {
    // Forward only past steps that are complete.
    for (let earlier = 0; earlier < Math.min(index, reviewIndex); earlier += 1) {
      if (!stepIsValid(earlier)) {
        reportOn(earlier);
        return;
      }
    }
    setCurrent(index);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (current < reviewIndex) {
      const invalid = fieldsIn(sectionRefs.current[current]).find((field) => !field.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      setCurrent(current + 1);
      return;
    }
    for (let index = 0; index < reviewIndex; index += 1) {
      if (!stepIsValid(index)) {
        reportOn(index);
        return;
      }
    }
    onSubmit(new FormData(event.currentTarget));
  }

  const progress = [
    ...visible.map((step, index) => {
      const value = form && step.summary ? step.summary(form).trim() : "";
      return { label: step.label, value: value || step.label, done: index < current && Boolean(value || !step.summary) };
    }),
    { label: "Done", value: "Review", done: false },
  ];

  return (
    <Modal title={title} eyebrow={eyebrow} onClose={onClose} wide={wide}>
      <form
        ref={formRef}
        className="crm-form crm-flow"
        noValidate
        onSubmit={submit}
        onInput={refresh}
        onChange={refresh}
      >
        <ol className="crm-field-span crm-flow-steps" aria-label="Steps">
          {progress.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              <button
                type="button"
                className={index === current ? "is-current" : item.done ? "is-done" : undefined}
                aria-current={index === current ? "step" : undefined}
                onClick={() => goTo(index)}
              >
                <span className="crm-flow-dot" aria-hidden="true">
                  {item.done && index !== current ? <Check /> : index + 1}
                </span>
                <span className="crm-flow-step-text">
                  <small>{item.label}</small>
                  {item.value}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {visible.map((step, index) => (
          <section
            key={step.id}
            ref={(node) => {
              sectionRefs.current[index] = node;
            }}
            className="crm-field-span crm-flow-stage"
            hidden={index !== current}
            aria-label={step.question}
          >
            <h3>{step.question}</h3>
            <div className="crm-flow-fields">{step.content}</div>
          </section>
        ))}

        <section className="crm-field-span crm-flow-stage" hidden={current !== reviewIndex} aria-label={reviewQuestion}>
          <h3>{reviewQuestion}</h3>
          {current === reviewIndex && form ? (
            <div className="crm-flow-review">
              {visible.map((step, index) => {
                const rows = (step.review?.(form) ?? []).filter((row) => row.value.trim());
                if (!rows.length) return null;
                return (
                  <div key={step.id} className="crm-flow-review-part">
                    <div className="crm-flow-review-head">
                      <span>{step.label}</span>
                      <button
                        type="button"
                        className="crm-flow-edit"
                        aria-label={`Change ${step.label.toLowerCase()}`}
                        onClick={() => setCurrent(index)}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    </div>
                    <dl>
                      {rows.map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>
          ) : null}
          {reviewExtra}
        </section>

        {error ? (
          <div className="crm-inline-error crm-field-span" role="alert">
            {error}
          </div>
        ) : null}

        <footer>
          {current > 0 ? (
            <button className="crm-button-secondary" type="button" onClick={() => setCurrent(current - 1)}>
              Back
            </button>
          ) : (
            <button className="crm-button-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="crm-button-primary" type="submit" disabled={busy}>
            {current < reviewIndex ? "Continue" : busy ? "Saving..." : submitLabel}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** Big tap-to-pick cards for a short list of choices (radio buttons underneath). */
export function ChoiceCards({
  name,
  options,
  defaultValue,
  value,
  onChange,
  columns = 3,
  label,
}: {
  name?: string;
  options: { value: string; label: string; hint?: string }[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  columns?: 2 | 3 | 4;
  label: string;
}) {
  return (
    <div className={`crm-flow-choices cols-${columns}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className="crm-flow-choice">
          <input
            type="radio"
            name={name}
            value={option.value}
            {...(value !== undefined
              ? { checked: value === option.value, onChange: () => onChange?.(option.value) }
              : { defaultChecked: defaultValue === option.value, onChange: () => onChange?.(option.value) })}
          />
          <span>
            <strong>{option.label}</strong>
            {option.hint ? <small>{option.hint}</small> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Text for the review card: the label of the selected option. */
export function choiceLabel(options: { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Picks a business: cards for a handful, a dropdown for a long list. With a
 * single business there is nothing to choose, so the parent skips the step
 * and sends that business as a hidden field instead.
 */
export function BusinessChoice({
  name,
  clients,
  value,
  defaultValue,
  onChange,
}: {
  name?: string;
  clients: { id: string; businessName: string }[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  if (clients.length > 9)
    return (
      <select
        name={name}
        aria-label="Business"
        required
        {...(value !== undefined
          ? { value, onChange: (event) => onChange?.(event.target.value) }
          : { defaultValue: defaultValue ?? clients[0]?.id })}
      >
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.businessName}
          </option>
        ))}
      </select>
    );
  return (
    <ChoiceCards
      name={name}
      label="Business"
      columns={2}
      value={value}
      defaultValue={value === undefined ? (defaultValue ?? clients[0]?.id) : undefined}
      onChange={onChange}
      options={clients.map((client) => ({ value: client.id, label: client.businessName }))}
    />
  );
}

/**
 * One-tap buttons that fill another field, e.g. "Tomorrow 9 am" for a due
 * date. The field is found by name in the same form; an input event is sent so
 * the flow's progress bar sees the new value.
 */
export function QuickFill({
  target,
  options,
}: {
  target: string;
  options: { label: string; value: (form: HTMLFormElement) => string | null }[];
}) {
  return (
    <div className="crm-flow-quick">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          className="crm-flow-chip"
          onClick={(event) => {
            const form = event.currentTarget.form;
            const field = form?.elements.namedItem(target);
            if (!form || !(field instanceof HTMLInputElement)) return;
            const next = option.value(form);
            if (next === null) {
              field.focus();
              return;
            }
            field.value = next;
            field.dispatchEvent(new Event("input", { bubbles: true }));
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A local "YYYY-MM-DDTHH:mm" string for a datetime-local input. */
export function localInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
