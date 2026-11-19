import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The icon iPhones use on the home screen. iOS rounds the corners itself, so this one is a full square. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
          color: "white",
          fontSize: 112,
          fontWeight: 700,
        }}
      >
        R
      </div>
    ),
    size,
  );
}
