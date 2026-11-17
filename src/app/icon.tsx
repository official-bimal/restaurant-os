import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** The app icon: the same teal tile and "R" as the logo in the sidebar. Drawn here, no image file needed. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f857a",
          color: "white",
          fontSize: 320,
          fontWeight: 700,
          borderRadius: 112,
        }}
      >
        R
      </div>
    ),
    size,
  );
}
