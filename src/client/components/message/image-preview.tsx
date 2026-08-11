"use client";

import { Download } from "lucide-react";
import type { FileSummary } from "@/shared/types";
import { Modal } from "../ui/primitives";

export function ImagePreview({ file, onClose }: { file: FileSummary; onClose: () => void }) {
  return (
    <Modal
      title={file.name}
      onClose={onClose}
      width={1120}
      footer={
        <a className="button ghost" href={file.url} download={file.name}>
          <Download size={16} />
          Download
        </a>
      }
    >
      <div className="image-preview-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.url} alt={file.name} />
      </div>
    </Modal>
  );
}
