import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRsvpsByName, rsvpNameKey } from "../app/rsvp-data.ts";

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
