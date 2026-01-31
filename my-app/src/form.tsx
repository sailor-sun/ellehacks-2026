import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { upload } from "@vercel/blob/client";

const formSchema = z
  .object({
    image: z.any().optional(),
    link: z.string().optional(),
    comments: z.string().optional(),
  })
  .refine(
    (v) =>
      v.image ||
      (v.link && v.link.trim() !== "") ||
      (v.comments && v.comments.trim() !== ""),
    { message: "You must upload something or add a comment.", path: ["comments"] }
  );

type FormData = z.infer<typeof formSchema>;

export default function Form() {
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { image: undefined, link: "", comments: "" },
  });

  const values = watch();
  const canAnalyze =
    !!values.image || values.link?.trim() !== "" || values.comments?.trim() !== "";

  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [uploadUrl, setUploadUrl] = React.useState<string>("");

  async function onSubmit(form: FormData) {
    setLoading(true);
    setResult(null);

    try {
      let image_url = "";

      // 1) 이미지가 있으면 Vercel Blob 업로드
      if (form.image instanceof File) {
        const file = form.image as File;

        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });

        image_url = blob.url;
        setUploadUrl(blob.url);
      }

      // 2) analyze로 URL만 보내기
      const payload = {
        messages_text: "",
        user_context: "",
        link_url: form.link || "",
        extra_notes: form.comments || "",
        image_url,
      };

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      // 3) JSON이 아니어도 에러 본문(raw) 노출
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: "Non-JSON response from /api/analyze", raw: text };
      }

      if (!res.ok) {
        setResult({ status: res.status, ...parsed });
        return;
      }

      setResult(parsed);
    } catch (e: any) {
      setResult({ error: "Failed", detail: String(e?.message || e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "20px auto", padding: 20, border: "1px solid #ccc", borderRadius: 8 }}>
      <h2>Scam Check</h2>
      <p>Upload a screenshot/profile photo, paste a link, or add notes.</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div style={{ marginBottom: 12 }}>
          <label>Upload Image</label>
          <Controller
            name="image"
            control={control}
            render={({ field }) => (
              <input
                type="file"
                accept="image/*"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  field.onChange(e.target.files?.[0])
                }
              />
            )}
          />
          {uploadUrl && (
            <div style={{ fontSize: 12, marginTop: 6 }}>
              Uploaded:{" "}
              <a href={uploadUrl} target="_blank" rel="noreferrer">
                open
              </a>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Paste Link / URL</label>
          <Controller
            name="link"
            control={control}
            render={({ field }) => (
              <input {...field} placeholder="https://example.com" style={{ width: "100%", padding: 8 }} />
            )}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Comments</label>
          <Controller
            name="comments"
            control={control}
            render={({ field }) => (
              <textarea {...field} rows={4} placeholder="Extra details..." style={{ width: "100%", padding: 8 }} />
            )}
          />
          {errors.comments && <p style={{ color: "red" }}>{errors.comments.message}</p>}
        </div>

        <button type="submit" disabled={!canAnalyze || loading} style={{ padding: "10px 18px" }}>
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </form>

      {result && (
        <pre style={{ marginTop: 16, background: "#f7f7f7", padding: 12, overflowX: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
