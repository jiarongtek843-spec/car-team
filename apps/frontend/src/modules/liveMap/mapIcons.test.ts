import { describe, expect, it } from "vitest";
import { createDriverIcon, DRIVER_MARKER_COLOR } from "./mapIcons";

describe("createDriverIcon", () => {
  it("uses the status color and a solid border when the location is fresh", () => {
    const icon = createDriverIcon("AVAILABLE", false);
    const html = icon.options.html as string;
    expect(html).toContain(DRIVER_MARKER_COLOR.AVAILABLE);
    expect(html).toContain("2px solid #fff");
    expect(html).toContain("opacity:1");
  });

  it("greys out with a dashed border when the location is stale, regardless of status", () => {
    const icon = createDriverIcon("ON_TRIP", true);
    const html = icon.options.html as string;
    expect(html).toContain(DRIVER_MARKER_COLOR.OFFLINE);
    expect(html).not.toContain(DRIVER_MARKER_COLOR.ON_TRIP);
    expect(html).toContain("dashed");
    expect(html).toContain("opacity:0.55");
  });

  it("defaults to fresh (not stale) when the flag is omitted", () => {
    const icon = createDriverIcon("PENDING_OFFER");
    const html = icon.options.html as string;
    expect(html).toContain(DRIVER_MARKER_COLOR.PENDING_OFFER);
    expect(html).toContain("opacity:1");
  });
});
