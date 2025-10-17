"use client";

import React from "react";
import { Plus, Loader2, Check, X, Edit3, Trash2, Tag, GripVertical } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { PostgrestError } from "@supabase/supabase-js";

const ACCENT = "#01A920";

type Category = {
  id: string;
  name: string;
  slug: string;
  ordem: number; // novo campo
};

type EditableCategory = Category & { _editing?: boolean };

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function isPgErr(e: unknown): e is PostgrestError {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Partial<PostgrestError>;
  return typeof obj.code === "string" && typeof obj.message === "string";
}

export default function CategoriesPage() {
  const supabase = supabaseBrowser();

  const [items, setItems] = React.useState<EditableCategory[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Drag state
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);
  const [savingOrder, setSavingOrder] = React.useState(false);

  async function refetch() {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug, ordem")
      .order("ordem", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
      return;
    }
    setItems(((data ?? []) as Category[]).sort((a, b) => a.ordem - b.ordem));
  }

  // Carrega categorias do banco
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, slug, ordem")
        .order("ordem", { ascending: true })
        .order("created_at", { ascending: false });

      if (!ignore) {
        if (error) {
          console.error(error);
          setErr(error.message);
        } else {
          setItems(((data ?? []) as Category[]).sort((a, b) => a.ordem - b.ordem));
        }
        setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  // Auto-slug enquanto digita o nome
  React.useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  function resetForm() {
    setName("");
    setSlug("");
    setSlugTouched(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setOk(null);
    setErr(null);

    try {
      if (!name.trim()) throw new Error("Informe o nome");
      const finalSlug = (slug || slugify(name)).trim();
      if (!finalSlug) throw new Error("Slug inválido");

      // pega maior ordem atual
      const { data: maxRow, error: maxErr } = await supabase
        .from("categories")
        .select("ordem")
        .order("ordem", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) throw maxErr;
      const nextOrder = (maxRow?.ordem ?? 0) + 1;

      // Inserir no Supabase
      const { data, error } = await supabase
        .from("categories")
        .insert({ name: name.trim(), slug: finalSlug, ordem: nextOrder })
        .select("id, name, slug, ordem")
        .single();

      if (error) {
        if (isPgErr(error) && error.code === "23505") {
          throw new Error("Slug já existe. Escolha outro.");
        }
        throw error;
      }

      setItems((arr) => [...arr, data as Category].sort((a, b) => a.ordem - b.ordem));
      setOk("Categoria criada com sucesso!");
      resetForm();
    } catch (e: unknown) {
      setErr((e as Error)?.message || "Erro ao criar categoria");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(id: string) {
    setItems((arr) => arr.map((c) => (c.id === id ? { ...c, _editing: true } : c)));
  }

  function cancelEdit() {
    setItems((arr) => arr.map((c) => ({ ...c, _editing: false })));
  }

  async function saveEdit(id: string, newName: string, newSlug: string) {
    try {
      if (!newName.trim() || !newSlug.trim()) throw new Error("Preencha os campos");
      const { data, error } = await supabase
        .from("categories")
        .update({ name: newName.trim(), slug: newSlug.trim() })
        .eq("id", id)
        .select("id, name, slug, ordem")
        .single();

      if (error) {
        if (isPgErr(error) && error.code === "23505") throw new Error("Slug já existe");
        throw error;
      }

      setItems((arr) =>
        arr
          .map((c) => (c.id === id ? { ...(data as Category), _editing: false } : c))
          .sort((a, b) => a.ordem - b.ordem),
      );
    } catch (e: unknown) {
      setErr((e as Error)?.message || "Erro ao salvar");
    }
  }

  async function remove(id: string) {
    if (!confirm("Remover categoria?")) return;
    try {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
      setItems((arr) => arr.filter((c) => c.id !== id));
    } catch (e: unknown) {
      setErr((e as Error)?.message || "Erro ao remover");
    }
  }

  // ---------- Drag & Drop ----------
  function reorderLocalByIds(arr: EditableCategory[], fromId: string, toId: string) {
    const next = [...arr];
    const fromIndex = next.findIndex((c) => c.id === fromId);
    const toIndex = next.findIndex((c) => c.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return next;

    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);

    // reindexa ordens localmente (1..N)
    return next.map((c, i) => ({ ...c, ordem: i + 1 }));
  }

  async function persistOrder(arr: EditableCategory[]) {
  setSavingOrder(true);
  setOk(null);
  setErr(null);

  try {
    const orderedIds = arr.map((c) => c.id);
    const { error } = await supabase.rpc("reorder_categories", { p_ids: orderedIds });
    if (error) throw error;

    // refetch para sincronizar e garantir que a ordem do banco refletiu na UI
    await refetch();
    setOk("Ordem salva!");
  } catch (e) {
    setErr((e as Error)?.message || "Falha ao salvar nova ordem");
  } finally {
    setSavingOrder(false);
  }
}

  function handleDragStart(id: string) {
    setDragId(id);
  }

  function handleDragOver(e: React.DragEvent<HTMLLIElement>, overId: string) {
    e.preventDefault();
    if (dragOverId !== overId) setDragOverId(overId);
  }

  async function handleDrop(e: React.DragEvent<HTMLLIElement>, dropTargetId: string) {
    e.preventDefault();
    if (!dragId || dragId === dropTargetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const next = reorderLocalByIds(items, dragId, dropTargetId);
    setItems(next);
    setDragId(null);
    setDragOverId(null);
    await persistOrder(next);
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  return (
    <div className="max-w-screen-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Categorias</h1>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Tag className="w-4 h-4" /> coleções do catálogo
        </span>
      </div>

      {/* Formulário de criação */}
      <form onSubmit={onSubmit} className="space-y-3 mb-6">
        <div className="space-y-1">
          <label className="text-sm text-gray-700">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Vestidos"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-700">Slug</label>
            <button
              type="button"
              onClick={() => setSlug(slugify(name))}
              className="text-xs underline text-gray-600"
            >
              gerar do nome
            </button>
          </div>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="ex.: vestidos"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
          <p className="text-xs text-gray-500">O slug precisa ser único.</p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white shadow-sm active:scale-[0.99]"
            style={{ backgroundColor: ACCENT }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Criar categoria</span>
          </button>

          {ok && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-xl">
              <Check className="w-4 h-4" /> {ok}
            </span>
          )}
          {(err || savingOrder) && (
            <span className="inline-flex items-center gap-1 text-sm text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-xl">
              {savingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              {savingOrder ? "Salvando ordem..." : err}
            </span>
          )}
        </div>
      </form>

      {/* Lista de categorias (arrastável) */}
      {loading ? (
        <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
          Carregando...
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => {
            const isDragging = dragId === c.id;
            const isOver = dragOverId === c.id && dragId !== c.id;

            return (
              <li
                key={c.id}
                className={`p-3 rounded-xl border bg-white shadow-sm transition
                  ${isOver ? "border-blue-300 ring-2 ring-blue-100" : "border-gray-100"}
                  ${isDragging ? "opacity-60" : ""}
                `}
                draggable={!c._editing}
                onDragStart={() => handleDragStart(c.id)}
                onDragOver={(e) => handleDragOver(e, c.id)}
                onDrop={(e) => handleDrop(e, c.id)}
                onDragEnd={handleDragEnd}
              >
                {c._editing ? (
                  <EditRow
                    category={c}
                    onCancel={cancelEdit}
                    onSave={(payload) => saveEdit(c.id, payload.name, payload.slug)}
                  />
                ) : (
                  <ViewRow
                    category={c}
                    onEdit={() => startEdit(c.id)}
                    onDelete={() => remove(c.id)}
                  />
                )}
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="p-3 rounded-xl border border-gray-100 bg-white text-sm text-gray-600">
              Nenhuma categoria cadastrada.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ViewRow({
  category,
  onEdit,
  onDelete,
}: {
  category: Category;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-600 select-none">
          {category.ordem}
        </span>
        <div>
          <div className="text-sm font-medium">{category.name}</div>
          <div className="text-xs text-gray-500">/{category.slug}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white text-gray-500 cursor-grab select-none inline-flex items-center gap-1">
          <GripVertical className="w-4 h-4" />
          arraste
        </span>
        <button
          onClick={onEdit}
          className="px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-700 bg-white"
          title="Editar"
        >
          <Edit3 className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-700 bg-white"
          title="Excluir"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function EditRow({
  category,
  onCancel,
  onSave,
}: {
  category: Category;
  onCancel: () => void;
  onSave: (c: Category) => void;
}) {
  const [name, setName] = React.useState(category.name);
  const [slug, setSlug] = React.useState(category.slug);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      if (!name.trim() || !slug.trim()) throw new Error("Preencha os campos");
      await onSave({ ...category, name: name.trim(), slug: slug.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex-1 flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl border border-gray-200"
        />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-40 px-3 py-2 rounded-xl border border-gray-200"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleSave}
          className="px-3 py-2 rounded-xl text-white text-xs"
          style={{ backgroundColor: ACCENT }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
        </button>
        <button onClick={onCancel} className="px-3 py-2 rounded-xl border border-gray-200 text-xs">
          Cancelar
        </button>
      </div>
    </div>
  );
}
