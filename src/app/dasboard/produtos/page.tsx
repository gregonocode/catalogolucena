"use client";

import React from "react";
import { Plus, Loader2, Check, X, Image as ImageIcon, Tag } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

type Category = { id: string; name: string; slug: string };

type FormState = {
  title: string;
  description: string;
  priceBRL: string;
  active: boolean;
  categoryIds: string[];
  imageFile?: File | null;
};

export default function ProductsPage() {
  const supabase = supabaseBrowser();

  const [submitting, setSubmitting] = React.useState(false);
  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<FormState>({
    title: "",
    description: "",
    priceBRL: "",
    active: true,
    categoryIds: [],
    imageFile: null,
  });

  const [categories, setCategories] = React.useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = React.useState(true);

  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoadingCats(true);
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, slug")
        .order("created_at", { ascending: false });
      if (!ignore) {
        if (error) {
          console.error(error);
        } else {
          setCategories(data ?? []);
        }
        setLoadingCats(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  // Helpers de preço sem regex
  function onlyDigits(text: string) {
    return Array.from(text)
      .filter((ch) => ch >= "0" && ch <= "9")
      .join("");
  }
  function maskBRL(value: string) {
    const digits = onlyDigits(value);
    const asNumber = Number(digits || "0");
    const cents = asNumber / 100;
    return cents.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function parseBRLToCents(masked: string) {
    const cleaned = masked
      .replace("R$", "")
      .split(" ")
      .join("")
      .split(".")
      .join("")
      .replace(",", ".");
    const num = Number(cleaned || "0");
    return Math.round(num * 100);
  }

  function validate(): string | null {
    if (!form.title.trim()) return "Informe o nome do produto";
    if (!form.priceBRL.trim()) return "Informe o preço";
    return null;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setOk(null);
    setErr(null);

    try {
      const v = validate();
      if (v) throw new Error(v);

      const price_cents = parseBRLToCents(form.priceBRL);

      // 1) Inserir produto (sem amount)
      const { data: product, error: prodErr } = await supabase
        .from("products")
        .insert({
          title: form.title.trim(),
          description: form.description.trim() || null,
          price_cents,
          active: form.active,
        })
        .select("id")
        .single<{ id: string }>();

      if (prodErr) throw prodErr;

      // 2) Upload de imagem (opcional)
      if (form.imageFile) {
        const file = form.imageFile;
        const path = `products/${product.id}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("produtos")
          .upload(path, file, {
            cacheControl: "3600",
            upsert: true,
            contentType: file.type || undefined,
          });
        if (upErr) throw upErr;

        const { error: imgErr } = await supabase.from("product_images").insert({
          product_id: product.id,
          storage_path: path,
          is_primary: true,
        });
        if (imgErr) throw imgErr;
      }

      // 3) Vincular categorias (se houver)
      if (form.categoryIds.length) {
        const payload = form.categoryIds.map((category_id) => ({
          product_id: (product as { id: string }).id,
          category_id,
        }));
        const { error: pcErr } = await supabase.from("product_categories").insert(payload);
        if (pcErr) throw pcErr;
      }

      setOk("Produto criado com sucesso!");
      setForm({
        title: "",
        description: "",
        priceBRL: "",
        active: true,
        categoryIds: [],
        imageFile: null,
      });
    } catch (e: unknown) {
      console.error(e);
      setErr((e as Error)?.message || "Erro ao criar produto");
    } finally {
      setSubmitting(false);
    }
  }

  function onPriceChange(v: string) {
    setForm((f) => ({ ...f, priceBRL: maskBRL(v) }));
  }

  function toggleCategory(id: string) {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((x) => x !== id)
        : [...f.categoryIds, id],
    }));
  }

  return (
    <div className="max-w-screen-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Produtos</h1>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Tag className="w-4 h-4" /> cadastro conectado
        </span>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-gray-700">Nome do produto</label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Ex.: Camiseta Básica Unissex"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Descrição</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Detalhes do produto (tecido, modelagem, etc.)"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Preço</label>
          <input
            required
            inputMode="numeric"
            value={form.priceBRL}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="R$ 0,00"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        {/* (removido) Estoque/amount */}

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Categorias</label>
          <div className="flex flex-wrap gap-2">
            {loadingCats ? (
              <span className="text-xs text-gray-500">Carregando...</span>
            ) : categories.length ? (
              categories.map((c) => {
                const active = form.categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCategory(c.id)}
                    className={`px-3 py-1.5 rounded-full border text-sm ${
                      active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                    }`}
                    style={active ? { backgroundColor: ACCENT } : {}}
                  >
                    {c.name}
                  </button>
                );
              })
            ) : (
              <span className="text-xs text-gray-500">Nenhuma categoria. Crie em “Categorias”.</span>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Imagem principal</label>
          <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setForm((f) => ({ ...f, imageFile: e.target.files?.[0] }))}
            />
            <span className="grid place-items-center w-10 h-10 rounded-lg bg-gray-100 border border-gray-200">
              <ImageIcon className="w-5 h-5 text-gray-600" />
            </span>
            <div className="flex-1">
              <div className="text-sm">Clique para selecionar</div>
              <div className="text-xs text-gray-500">PNG ou JPG até 10MB</div>
            </div>
            {form.imageFile ? (
              <span className="text-xs text-gray-600 truncate max-w-[140px]">{form.imageFile.name}</span>
            ) : null}
          </label>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-700">Ativo</label>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
            className={`w-12 h-6 rounded-full relative transition-colors ${form.active ? "bg-emerald-500" : "bg-gray-300"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                form.active ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white shadow-sm active:scale-[0.99]"
            style={{ backgroundColor: ACCENT }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Criar produto</span>
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

      <div className="mt-6 p-3 rounded-xl border border-gray-100 bg-gray-50 text-xs text-gray-600">
        <p className="mb-1 font-medium">Próximos passos:</p>
        <ol className="list-decimal ml-4 space-y-1">
          <li>Na home (src/app/page.tsx), listar products (ativos) e imagem primária.</li>
          <li>Na lista de produtos, exibir Imagem / Produto / Preço / Categorias / Status.</li>
          <li>Implementar edição do produto (update) e upload secundário de imagens.</li>
          <li>(Opcional) Validar tamanho/tipo da imagem antes do upload.</li>
          <li>Gestão de estoque agora é por <b>variantes</b> no módulo “Variantes”.</li>
        </ol>
      </div>
    </div>
  );
}
