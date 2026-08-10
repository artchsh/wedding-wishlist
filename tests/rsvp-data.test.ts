import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupRsvpsByName,
  normalizeRsvps,
  rsvpNameKey,
  countGroupPeople,
  summarizeRsvps,
} from "../app/rsvp-data.ts";

function record(
  name: string,
  attending: boolean,
  createdAt: string,
  submitterId = ""
) {
  return { id: `${name}-${createdAt}`, name, attending, submitterId, createdAt };
}

test("groups records that differ only by case and spacing", () => {
  const groups = groupRsvpsByName([
    record("Салима Е.", true, "2026-08-10T10:00:00.000Z"),
    record("салима   е.", false, "2026-08-10T10:01:00.000Z"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, rsvpNameKey("Салима Е."));
  assert.equal(groups[0].records.length, 2);
});

test("the newest record is the group's latest answer", () => {
  const groups = groupRsvpsByName([
    record("Тимур Б.", false, "2026-08-10T10:05:00.000Z"),
    record("Тимур Б.", true, "2026-08-10T10:09:00.000Z"),
  ]);

  assert.equal(groups[0].latest.attending, true);
});

test("normalizes a missing submitterId to an empty string", () => {
  const document = normalizeRsvps({
    records: [
      {
        id: "a",
        name: "Салима Е.",
        attending: true,
        createdAt: "2026-08-10T10:00:00.000Z",
      },
    ],
  });

  assert.equal(document.records[0].submitterId, "");
});

test("keeps a submitterId that is present", () => {
  const document = normalizeRsvps({
    records: [
      {
        id: "a",
        name: "Салима Е.",
        attending: true,
        submitterId: "device-1",
        createdAt: "2026-08-10T10:00:00.000Z",
      },
    ],
  });

  assert.equal(document.records[0].submitterId, "device-1");
});

test("one browser answering seven times is one person and no flag", () => {
  const [group] = groupRsvpsByName([
    record("Салима Е.", false, "2026-08-10T14:09:00.000Z", "device-1"),
    record("Салима Е.", true, "2026-08-10T14:09:30.000Z", "device-1"),
    record("Салима Е.", true, "2026-08-10T14:10:00.000Z", "device-1"),
    record("Салима Е.", false, "2026-08-10T14:11:00.000Z", "device-1"),
    record("Салима Е.", true, "2026-08-10T14:11:30.000Z", "device-1"),
  ]);

  assert.equal(group.submitters.length, 1);
  assert.equal(group.needsReview, false);
  assert.equal(group.answerChanges, 3);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 0 });
});

test("repeating the same answer is not a change of mind", () => {
  const [group] = groupRsvpsByName([
    record("Тимур Б.", true, "2026-08-10T10:00:00.000Z", "device-1"),
    record("Тимур Б.", true, "2026-08-10T10:01:00.000Z", "device-1"),
    record("Тимур Б.", true, "2026-08-10T10:02:00.000Z", "device-1"),
  ]);

  assert.equal(group.answerChanges, 0);
  assert.equal(group.needsReview, false);
});

test("two browsers under one name need review and count as two people", () => {
  const [group] = groupRsvpsByName([
    record("Алия К.", true, "2026-08-10T10:00:00.000Z", "device-1"),
    record("Алия К.", false, "2026-08-10T10:01:00.000Z", "device-2"),
  ]);

  assert.equal(group.submitters.length, 2);
  assert.equal(group.needsReview, true);
  assert.equal(group.answerChanges, 0);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 1 });
});

test("two browsers that agree still need review, because the count is ambiguous", () => {
  const [group] = groupRsvpsByName([
    record("Данияр Т.", true, "2026-08-10T10:00:00.000Z", "device-1"),
    record("Данияр Т.", true, "2026-08-10T10:01:00.000Z", "device-2"),
  ]);

  assert.equal(group.needsReview, true);
  assert.deepEqual(countGroupPeople(group), { coming: 2, notComing: 0 });
});

test("legacy records with no submitterId share one bucket", () => {
  const [group] = groupRsvpsByName([
    record("Айгерим С.", true, "2026-08-10T10:00:00.000Z"),
    record("Айгерим С.", false, "2026-08-10T10:01:00.000Z"),
    record("Айгерим С.", true, "2026-08-10T10:02:00.000Z"),
  ]);

  assert.equal(group.submitters.length, 1);
  assert.equal(group.needsReview, false);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 0 });
});

test("legacy record and new device id together need review and count as two people", () => {
  const [group] = groupRsvpsByName([
    record("Нургис М.", true, "2026-08-10T10:00:00.000Z"),
    record("Нургис М.", false, "2026-08-10T10:01:00.000Z", "device-3"),
  ]);

  assert.equal(group.submitters.length, 2);
  assert.equal(group.needsReview, true);
  assert.deepEqual(countGroupPeople(group), { coming: 1, notComing: 1 });
});

test("the summary totals people, not names", () => {
  const summary = summarizeRsvps(
    groupRsvpsByName([
      record("Алия К.", true, "2026-08-10T10:00:00.000Z", "device-1"),
      record("Алия К.", false, "2026-08-10T10:01:00.000Z", "device-2"),
      record("Тимур Б.", true, "2026-08-10T10:02:00.000Z", "device-3"),
    ])
  );

  assert.equal(summary.coming, 2);
  assert.equal(summary.notComing, 1);
  assert.equal(summary.people, 3);
  assert.equal(summary.names, 2);
  assert.equal(summary.needsReview, 1);
});
