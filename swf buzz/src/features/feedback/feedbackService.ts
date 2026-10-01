import { signAndPublish } from "@/services/publish";
import { mediaService } from "@/services/MediaService";
import { AppError } from "@/services/errors";
import { prepareImageAttachment } from "@/features/messages/attachments";
import type { Attachment } from "@/protocol/imeta";
import {
  buildFeedbackEvent,
  collectDiagnostics,
  formatDiagnostics,
  mp4HeaderProblem,
  validateFeedbackMessage,
  type AttachmentKind,
  type FeedbackCategory,
} from "./feedbackModel";

/**
 * Sends feedback: uploads the attachments (on SEND, never on pick, so a
 * cancelled dialog leaves no orphan blobs), then signs and publishes the
 * kind 42000 event on the open community's socket. Resolves only when the
 * relay accepted it.
 */
export interface FeedbackFile {
  id: string;
  file: File;
  kind: AttachmentKind;
}

export interface SendFeedbackInput {
  category: FeedbackCategory | null;
  message: string;
  files: FeedbackFile[];
  includeDiagnostics: boolean;
  appVersion: string;
}

export interface SendProgress {
  /** Per file id: 0..1, or "error". */
  files: Record<string, number>;
  stage: "uploading" | "sending";
}

const VIDEO_AUTH_TTL_SECS = 1800;

async function uploadOne(item: FeedbackFile, onProgress: (f: number) => void): Promise<Attachment> {
  if (item.kind === "image") {
    const prepared = await prepareImageAttachment(item.file);
    const uploaded = await mediaService.upload(prepared.blob, { onProgress, purpose: "Upload feedback attachment" });
    return {
      url: uploaded.url,
      mimeType: uploaded.mimeType,
      sha256: uploaded.sha256,
      size: uploaded.size,
      dim: prepared.dim,
      filename: prepared.filename,
    };
  }
  const head = new Uint8Array(await item.file.slice(0, 16).arrayBuffer());
  const problem = mp4HeaderProblem(head);
  if (problem) throw new AppError("relay_rejected", problem);
  const uploaded = await mediaService.upload(item.file, {
    onProgress,
    purpose: "Upload feedback attachment",
    authTtlSecs: VIDEO_AUTH_TTL_SECS,
  });
  return {
    url: uploaded.url,
    mimeType: uploaded.mimeType,
    sha256: uploaded.sha256,
    size: uploaded.size,
    filename: item.file.name,
  };
}

export async function sendFeedback(
  input: SendFeedbackInput,
  onProgress: (progress: SendProgress) => void = () => undefined,
): Promise<{ eventId: string }> {
  const invalid = validateFeedbackMessage(input.message);
  if (invalid) throw new AppError("unknown", invalid);

  const progress: SendProgress = { files: Object.fromEntries(input.files.map((f) => [f.id, 0])), stage: "uploading" };
  const emit = () => onProgress({ ...progress, files: { ...progress.files } });
  emit();

  const attachments: Attachment[] = [];
  for (const item of input.files) {
    try {
      attachments.push(
        await uploadOne(item, (fraction) => {
          progress.files[item.id] = fraction;
          emit();
        }),
      );
      progress.files[item.id] = 1;
      emit();
    } catch (err) {
      progress.files[item.id] = -1;
      emit();
      throw err;
    }
  }

  if (input.includeDiagnostics) {
    const text = formatDiagnostics(collectDiagnostics(input.appVersion));
    const blob = new Blob([text], { type: "text/plain" });
    const uploaded = await mediaService.upload(blob, { purpose: "Upload feedback diagnostics" });
    attachments.push({
      url: uploaded.url,
      mimeType: uploaded.mimeType,
      sha256: uploaded.sha256,
      size: uploaded.size,
      filename: `feedback-diagnostics-${Date.now()}.txt`,
    });
  }

  progress.stage = "sending";
  emit();
  const signed = await signAndPublish(
    buildFeedbackEvent({ category: input.category, message: input.message, attachments }),
  );
  return { eventId: signed.id };
}
