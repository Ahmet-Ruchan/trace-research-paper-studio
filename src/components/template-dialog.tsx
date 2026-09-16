"use client";

import { useMemo } from "react";
import { templateFromProject } from "@/lib/narrative-templates";
import type { ResearchProject } from "@/lib/schema";
import { TemplateEditor } from "./template-editor";

type TemplateDialogProps = {
  project: ResearchProject;
  onClose: () => void;
};

/**
 * Bu anlatının yapısını şablon olarak kaydeder. Amaçlar iddia türlerinden
 * önerilir ama düzenlenebilir: şablon başka makalelere uygulanacak, bu
 * yüzden içeriğe değil işleve dair olmalı.
 */
export function TemplateDialog({ project, onClose }: TemplateDialogProps) {
  const initial = useMemo(() => templateFromProject(project, { name: "Untitled template" }), [project]);
  return (
    <TemplateEditor
      initial={initial}
      initialName=""
      mode="create"
      heading="Save this story's structure"
      intro="The template keeps the order of sections, their visuals and the kinds of claims they lean on, never the text. Pick it when you analyse the next paper."
      onClose={onClose}
    />
  );
}
