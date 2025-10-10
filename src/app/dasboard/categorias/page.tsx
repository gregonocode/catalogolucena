"use client";

import React from "react";
import { Plus, Loader2, Check, X, Edit3, Trash2, Tag } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

type Category = {
  id: string;
  name: string;
  slug: string;
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export default function CategoriesPage() {
  const supabase = supabaseBrowser();

  const [items, setItems] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Carrega categorias do banco
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, slug")
        .order("created_at", { ascending: false });
      if (!ignore) {
        if (error) {
          console.error(error);
          setErr(error.message);
        } else {
          setItems(data ?? []);
        }
        setLoading(false);
      }
    })();
    return () => { ignore = true; };
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

      // Inserir no Supabase
      const { data, error } = await supabase
        .from("categories")
        .insert({ name: name.trim(), slug: finalSlug })
        .select("id, name, slug")
        .single();
      if (error) {
        // 23505 = unique_violation
        if ((error as any).code === "23505") {
          throw new Error("Slug já existe. Escolha outro.");
        }
        throw error;
      }

      setItems((arr) => [data as Category, ...arr]);
      setOk("Categoria criada com sucesso!");
      resetForm();
    } catch (e: any) {
      setErr(e?.message || "Erro ao criar categoria");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(id: string) {
    setItems((arr) => arr.map((c) => (c.id === id ? { ...c, _editing: true } as any : c)));
  }

  function cancelEdit(id: string) {
    setItems((arr) => arr.map((c) => ({ ...(c as any), _editing: false } as any)));
  }

  async function saveEdit(id: string, name: string, slug: string) {
    try {
      if (!name.trim() || !slug.trim()) throw new Error("Preencha os campos");
      const { data, error } = await supabase
        .from("categories")
        .update({ name: name.trim(), slug: slug.trim() })
        .eq("id", id)
        .select("id, name, slug")
        .single();
      if (error) {
        if ((error as any).code === "23505") throw new Error("Slug já existe");
        throw error;
      }
      setItems((arr) => arr.map((c) => (c.id === id ? ({ ...(data as Category), _editing: false } as any) : c)));
    } catch (e: any) {
      setErr(e?.message || "Erro ao salvar");
    }
  }

  async function remove(id: string) {
    if (!confirm("Remover categoria?")) return;
    try {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
      setItems((arr) => arr.filter((c) => c.id !== id));
    } catch (e: any) {
      setErr(e?.message || "Erro ao remover");
    }
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
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
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
          {err && (
            <span className="inline-flex items-center gap-1 text-sm text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-xl">
              <X className="w-4 h-4" /> {err}
            </span>
          )}
        </div>
      </form>

      {/* Lista de categorias */}
      {loading ? (
        <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">Carregando...</div>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="p-3 rounded-xl border border-gray-100 bg-white shadow-sm">
              {(c as any)._editing ? (
                <EditRow
                  category={c}
                  onCancel={() => cancelEdit(c.id)}
                  onSave={(payload) => saveEdit(c.id, payload.name, payload.slug)}
                />
              ) : (
                <ViewRow category={c} onEdit={() => startEdit(c.id)} onDelete={() => remove(c.id)} />
              )}
            </li>
          ))}
          {items.length === 0 && (
            <li className="p-3 rounded-xl border border-gray-100 bg-white text-sm text-gray-600">Nenhuma categoria cadastrada.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function ViewRow({ category, onEdit, onDelete }: { category: Category; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{category.name}</div>
        <div className="text-xs text-gray-500">/{category.slug}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onEdit}
          className="px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-700 bg-white"
        >
          <Edit3 className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-700 bg-white"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function EditRow({ category, onCancel, onSave }: { category: Category; onCancel: () => void; onSave: (c: Category) => void }) {
  const [name, setName] = React.useState(category.name);
  const [slug, setSlug] = React.useState(category.slug);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      if (!name.trim() || !slug.trim()) throw new Error("Preencha os campos");
      await onSave({ ...category, name: name.trim(), slug: slug.trim() });
    } catch (e) {
      // noop visual
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
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded-xl border border-gray-200 text-xs"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
