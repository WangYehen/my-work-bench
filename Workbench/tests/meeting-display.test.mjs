import assert from "node:assert/strict";
import test from "node:test";

import { meetingEndLabel, meetingSignature, mergeDuplicateMeetings } from "../src/lib/meeting-display.js";

test("meeting signature merges exact duplicate events and preserves a count", () => {
  const event = { id: "one", title: "项目例会", startAt: "2026-08-13T02:00:00.000Z", endAt: "2026-08-13T03:00:00.000Z", location: "线上", meetingUrl: "https://example.test/meeting" };
  const duplicate = { ...event, id: "two" };
  assert.equal(meetingSignature(event), meetingSignature(duplicate));
  assert.deepEqual(mergeDuplicateMeetings([event, duplicate]), [{ ...event, duplicateCount: 2 }]);
});

test("invalid or zero meeting duration is shown as pending confirmation", () => {
  const format = (value) => value.slice(11, 16);
  assert.equal(meetingEndLabel({ startAt: "2026-08-13T10:00:00", endAt: "2026-08-13T10:00:00" }, format), "时间待确认");
  assert.equal(meetingEndLabel({ startAt: "bad", endAt: "bad" }, format), "时间待确认");
  assert.equal(meetingEndLabel({ startAt: "2026-08-13T10:00:00", endAt: "2026-08-13T11:00:00" }, format), "11:00 结束");
});
