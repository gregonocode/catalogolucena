"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Check,
  X,
  Image as ImageIcon,
  Tag,
  Trash2,
  Layers3,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

type Category = { id: string; name: string; slug: string };
type Product = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  created_at: string;
  deleted_at: string | null;
};
type ProductImage = {
  id: string;
  product_id: string;
  storage_path: string;
  is_primary: boolean;
};

type ProductWithStockRow = {
  id: string;
  total_stock: number;
};

type FormState = {
  title: string;
  description: string;
  priceBRL: string;
  active: boolean;
  categoryIds: string[];
  newImageFile?: File | null;
  currentImageUrl?: string | null;
  currentImagePath?: string | null;
};

function onlyDigits(text: string) {
  return Array.from(text).filter((ch) => ch >= "0" && ch <= "9").join("");
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
function formatBRLFromCents(cents: number) {
  const value = (Number.isFinite(cents) ? cents : 0) / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [removingImg, setRemovingImg] = React.useState(false);

  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<FormState>({
    title: "",
    description: "",
    priceBRL: "",
    active: true,
    categoryIds: [],
    newImageFile: null,
    currentImageUrl: null,
    currentImagePath: null,
  });

  const [categories, setCategories] = React.useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = React.useState(true);

  const [totalStock, setTotalStock] = React.useState<number>(0);

  // Carregar produto + imagem primária + categorias + vínculos + estoque total
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      if (!id) return;
      setLoading(true);
      setErr(null);

      try {
        // ==== 1) Produto (tabela principal)
        const productPromise = supabase
          .from("products")
          .select("*")
          .eq("id", id)
          .single<Product>();

        // ==== 2) Imagens do produto
        const imagesPromise = supabase
          .from("product_images")
          .select("id, product_id, storage_path, is_primary")
          .eq("product_id", id);

        // ==== 3) Categorias disponíveis
        const catsPromise = supabase
          .from("categories")
          .select("id, name, slug")
          .order("created_at", { ascending: false });

        // ==== 4) Vínculos do produto → categorias selecionadas
        const pcPromise = supabase
          .from("product_categories")
          .select("category_id")
          .eq("product_id", id);

        // ==== 5) Estoque total (view que você atualizou)
        const stockPromise = supabase
          .from("products_with_stock")
          .select("id, total_stock")
          .eq("id", id)
          .single<ProductWithStockRow>();

        const [
          { data: p, error: pErr },
          { data: imgs, error: iErr },
          { data: cats, error: catsErr },
          { data: pc, error: pcErr },
          { data: stockRow, error: stockErr },
        ] = await Promise.all([productPromise, imagesPromise, catsPromise, pcPromise, stockPromise]);

        if (pErr) throw pErr;
        if (!p) throw new Error("Produto não encontrado");
        if (iErr) throw iErr;
        if (catsErr) throw catsErr;
        if (pcErr) throw pcErr;
        if (stockErr && stockErr.code !== "PGRST116") throw stockErr; // tolera não encontrar na view

        // primária (ou primeira)
        let currentImageUrl: string | null = null;
        let currentImagePath: string | null = null;

        const arrImages = (imgs ?? []) as ProductImage[];
        const primary =
          arrImages.find((i) => i.is_primary) ||
          (arrImages.length ? [...arrImages].sort((a, b) => a.id.localeCompare(b.id))[0] : undefined);

        if (primary?.storage_path) {
          const path = primary.storage_path;
          const { data } = supabase.storage.from("produtos").getPublicUrl(path);
          currentImageUrl = data.publicUrl ?? null;
          currentImagePath = path;
        }

        const selectedIds = (pc ?? []).map((r) => (r as { category_id: string }).category_id);

        if (!ignore) {
          setCategories((cats ?? []) as Category[]);
          setForm({
            title: p.title,
            description: p.description ?? "",
            priceBRL: formatBRLFromCents(p.price_cents),
            active: p.active,
            categoryIds: selectedIds,
            newImageFile: null,
            currentImageUrl,
            currentImagePath,
          });
          setTotalStock(Number.isFinite(stockRow?.total_stock) ? stockRow!.total_stock : 0);
        }
      } catch (e) {
        if (!ignore) {
          const msg = e instanceof Error ? e.message : "Erro ao carregar produto";
          setErr(msg);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
          setLoadingCats(false);
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, [id, supabase]);

  function onPriceChange(v: string) {
    setForm((f) => ({ ...f, priceBRL: maskBRL(v) }));
  }

  function toggleCategory(catId: string) {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(catId)
        ? f.categoryIds.filter((x) => x !== catId)
        : [...f.categoryIds, catId],
    }));
  }

  async function handleRemoveCurrentImage() {
    if (!form.currentImagePath) return;
    if (!confirm("Remover a imagem atual?")) return;
    setRemovingImg(true);
    setErr(null);
    setOk(null);
    try {
      // remove arquivo
      const { error: remErr } = await supabase.storage.from("produtos").remove([form.currentImagePath]);
      if (remErr) console.warn("Falha ao remover arquivo:", remErr.message);

      // remove registro
      await supabase.from("product_images").delete().eq("storage_path", form.currentImagePath);

      // limpa do estado
      setForm((f) => ({ ...f, currentImagePath: null, currentImageUrl: null }));
      setOk("Imagem removida");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao remover imagem";
      setErr(msg);
    } finally {
      setRemovingImg(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setOk(null);
    setErr(null);

    try {
      if (!form.title.trim()) throw new Error("Informe o nome do produto");

      const price_cents = parseBRLToCents(form.priceBRL);

      // 1) Atualiza produto (sem amount)
      const { error: upErr } = await supabase
        .from("products")
        .update({
          title: form.title.trim(),
          description: form.description.trim() || null,
          price_cents,
          active: form.active,
        })
        .eq("id", id);
      if (upErr) throw upErr;

      // 2) Reaplica vínculos de categorias (reset simples)
      await supabase.from("product_categories").delete().eq("product_id", id as string);
      if (form.categoryIds.length) {
        const payload = form.categoryIds.map((category_id) => ({ product_id: id as string, category_id }));
        const { error: pcErr } = await supabase.from("product_categories").insert(payload);
        if (pcErr) throw pcErr;
      }

      // 3) Upload de nova imagem (opcional)
      if (form.newImageFile) {
        const file = form.newImageFile;
        const path = `products/${id}/${Date.now()}-${file.name}`;

        const { error: upImgErr } = await supabase.storage
          .from("produtos")
          .upload(path, file, {
            cacheControl: "3600",
            upsert: true,
            contentType: file.type || undefined,
          });
        if (upImgErr) throw upImgErr;

        // garante único primary
        await supabase.from("product_images").update({ is_primary: false }).eq("product_id", id as string);
        const { error: insImgErr } = await supabase.from("product_images").insert({
          product_id: id as string,
          storage_path: path,
          is_primary: true,
        });
        if (insImgErr) throw insImgErr;

        // remove antiga (opcional)
        if (form.currentImagePath) {
          const { error: remErr } = await supabase.storage.from("produtos").remove([form.currentImagePath]);
          if (remErr) console.warn("Falha ao remover arquivo antigo:", remErr.message);
          await supabase.from("product_images").delete().eq("storage_path", form.currentImagePath);
        }

        // atualiza preview após salvar
        const { data: pub } = supabase.storage.from("produtos").getPublicUrl(path);
        setForm((f) => ({
          ...f,
          newImageFile: null,
          currentImageUrl: pub?.publicUrl ?? null,
          currentImagePath: path,
        }));
      }

      setOk("Produto atualizado com sucesso!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao atualizar produto";
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-screen-sm mx-auto py-10 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="max-w-screen-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Link
            href="/dasboard/produtos/lista"
            className="px-2 py-1 rounded-lg border border-gray-200 bg-white inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
          <h1 className="text-lg font-semibold">Editar produto</h1>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Tag className="w-4 h-4" /> edição conectada
        </span>
      </div>

      {err && (
        <div className="mb-4 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {err}
        </div>
      )}
      {ok && (
        <div className="mb-4 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {ok}
        </div>
      )}

      {/* Info rápida do estoque total + atalho para variantes */}
      <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
        <div>
          <span className="text-gray-600">Estoque total (tamanhos + combinações): </span>
          <span className="font-semibold tabular-nums">{totalStock}</span>
        </div>
        <Link
          href="/dasboard/variantes"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white text-xs"
          title="Gerenciar variantes e estoque por combinação"
        >
          <Layers3 className="w-4 h-4" />
          Gerenciar variantes
        </Link>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Nome */}
        <div className="space-y-1">
          <label className="text-sm text-gray-700">Nome do produto</label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        {/* Descrição */}
        <div className="space-y-1">
          <label className="text-sm text-gray-700">Descrição</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        {/* Preço */}
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

        {/* Categorias */}
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

        {/* Imagem atual / troca */}
        <div className="space-y-2">
          <label className="text-sm text-gray-700">Imagem principal</label>

          <div className="flex items-center gap-3">
            <div className="w-[80px] h-[80px] rounded-xl bg-gray-100 border border-gray-200 overflow-hidden grid place-items-center">
              {form.currentImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.currentImageUrl} alt="Imagem atual" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon className="w-5 h-5 text-gray-600" />
              )}
            </div>

            <div className="flex-1">
              <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 cursor-pointer bg-white">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setForm((f) => ({ ...f, newImageFile: e.target.files?.[0] ?? null }))}
                />
                <span className="grid place-items-center w-10 h-10 rounded-lg bg-gray-100 border border-gray-200">
                  <ImageIcon className="w-5 h-5 text-gray-600" />
                </span>
                <div className="flex-1">
                  <div className="text-sm">Clique para selecionar uma nova imagem</div>
                  <div className="text-xs text-gray-500">PNG ou JPG até 10MB</div>
                </div>
                {form.newImageFile ? (
                  <span className="text-xs text-gray-600 truncate max-w-[140px]">{form.newImageFile.name}</span>
                ) : null}
              </label>

              {!!form.currentImageUrl && (
                <button
                  type="button"
                  onClick={handleRemoveCurrentImage}
                  disabled={removingImg}
                  className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs bg-white"
                >
                  {removingImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Remover imagem atual
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-700">Ativo</label>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
            className={`w-12 h-6 rounded-full relative transition-colors ${
              form.active ? "bg-emerald-500" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                form.active ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white shadow-sm active:scale-[0.99] disabled:opacity-70"
            style={{ backgroundColor: ACCENT }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span>Salvar alterações</span>
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
    </div>
  );
}
