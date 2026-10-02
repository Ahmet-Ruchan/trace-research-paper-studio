"use client";

import { useMemo } from "react";
import { useT } from "@/i18n/client";
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
  const t = useT().studio.templates;
  const untitled = t.untitled;
  const initial = useMemo(() => templateFromProject(project, { name: untitled }), [project, untitled]);
  return (
    <TemplateEditor
      initial={initial}
      initialName=""
      mode="create"
      heading={t.dialogHeading}
      intro={t.dialogIntro}
      onClose={onClose}
    />
  );
}
