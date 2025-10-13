// src/app/dasboard/produtos/page.tsx
"use client";

import React from "react";
import Link from "next/link";
import {
  Search,
  Pencil,
  Trash2,
  Image as ImageIcon,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";
const PAGE_SIZE = 10;

/** Linhas vindas da VIEW products_with_stock (p.* + total_stock) */
type ProductWithStockRow = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  created_at: string;
  /** soma das variantes */
  total_stock: number;
};

type ProductImage = {
  id: string;
  product_id: string;
  storage_path: string;
  is_primary: boolean;
};

type ListItem = {
  product: ProductWithStockRow;
  imgUrl: string | null;
};

function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === "string" ? m : "Erro desconhecido";
  }
  return "Erro desconhecido";
}

export default function ProductsListPage() {
  const supabase = supabaseBrowser();

  const [search, setSearch] = React.useState("");
  const [orderBy, setOrderBy] = React.useState<keyof ProductWithStockRow | "total_stock">(
    "created_at"
  );
  const [ascending, setAscending] = React.useState(false);

  const [page, setPage] = React.useState(0);
  const [total, setTotal] = React.useState(0);

  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<ListItem[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [warns, setWarns] = React.useState<string[]>([]);
  const [ok, setOk] = React.useState<string | null>(null);

  function formatBRLFromCents(cents: number) {
    const v = (cents || 0) / 100;
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    setOk(null);
    setWarns([]);

    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Busca na VIEW: products_with_stock
      let query = supabase
        .from("products_with_stock")
        .select("*", { count: "exact" })
        .order(orderBy as string, { ascending });

      if (search.trim()) {
        const q = search.trim();
        // title / description existem na view (vêm de products.*)
        query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
      }

      const { data, count, error } = await query.range(from, to);
      if (error) throw error;

      setTotal(count ?? 0);
      const list: ProductWithStockRow[] = Array.isArray(data)
        ? (data as ProductWithStockRow[])
        : [];

      if (list.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const ids = list.map((p) => p.id);

      // Carregar imagens principais (não aborta em erro)
      const byProductImgs = new Map<string, ProductImage[]>();
      try {
        const { data: imgs, error: imgErr } = await supabase
          .from("product_images")
          .select("id, product_id, storage_path, is_primary")
          .in("product_id", ids);

        if (imgErr) throw imgErr;

        const arr: ProductImage[] = Array.isArray(imgs) ? (imgs as ProductImage[]) : [];
        for (const im of arr) {
          const bucket = byProductImgs.get(im.product_id) ?? [];
          bucket.push(im);
          byProductImgs.set(im.product_id, bucket);
        }
      } catch (e: unknown) {
        console.error("Erro ao carregar product_images:", e);
        setWarns((w) => [...w, `product_images: ${errorMessage(e)}`]);
      }

      // Montar a lista com a URL pública da imagem primária
      const items: ListItem[] = list.map((p) => {
        const imgsFor = byProductImgs.get(p.id) ?? [];
        const primary =
          imgsFor.find((i) => i.is_primary) ||
          (imgsFor.length ? [...imgsFor].sort((a, b) => a.id.localeCompare(b.id))[0] : undefined);

        let imgUrl: string | null = null;
        if (primary?.storage_path) {
          const { data: pub } = supabase.storage.from("produtos").getPublicUrl(primary.storage_path);
          imgUrl = pub?.publicUrl ?? null;
        }

        return { product: p, imgUrl };
      });

      setRows(items);
    } catch (e: unknown) {
      const msg = errorMessage(e);
      console.error("ProductsListPage fetch error:", e);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [supabase, page, orderBy, ascending, search]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    fetchData();
  }

  function totalPages() {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }

  async function toggleActive(id: string, next: boolean) {
    try {
      setErr(null);
      await supabase.from("products").update({ active: next }).eq("id", id);
      setRows((prev) =>
        prev.map((it) =>
          it.product.id === id ? { ...it, product: { ...it.product, active: next } } : it
        )
      );
    } catch (e: unknown) {
      setErr(errorMessage(e));
    }
  }

  async function handleDelete(productId: string) {
    if (
      !confirm(
        "Tem certeza que deseja excluir este produto? As imagens no storage também serão removidas."
      )
    ) {
      return;
    }

    setErr(null);
    setOk(null);

    try {
      // 0) Verificar se existe item de pedido referenciando o produto
      const { count: orderItemsCount, error: countErr } = await supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .eq("product_id", productId);

      if (countErr) throw countErr;

      // 1) Carregar imagens (para eventualmente remover do storage)
      const { data: imgs, error: imgErr } = await supabase
        .from("product_images")
        .select("storage_path")
        .eq("product_id", productId);

      if (imgErr) throw imgErr;

      const paths: string[] = (Array.isArray(imgs) ? imgs : [])
        .map((i) => (i as { storage_path: string | null }).storage_path)
        .filter((pth): pth is string => typeof pth === "string" && pth.length > 0);

      // ====== CASO 1: Já existe em pedidos → SOFT DELETE ======
      if ((orderItemsCount ?? 0) > 0) {
        const { error: softErr } = await supabase
          .from("products")
          .update({ deleted_at: new Date().toISOString(), active: false })
          .eq("id", productId);
        if (softErr) throw softErr;

        if (paths.length) {
          const { error: remErr } = await supabase.storage.from("produtos").remove(paths);
          if (remErr) console.warn("Falha ao remover arquivos:", remErr.message);
        }

        await supabase.from("product_images").delete().eq("product_id", productId);
        await supabase.from("product_categories").delete().eq("product_id", productId);

        setRows((prev) => prev.filter((it) => it.product.id !== productId));
        setOk("Produto arquivado (soft delete). Itens de pedido existentes foram preservados.");
        if (rows.length - 1 === 0 && page > 0) setPage((p) => p - 1);
        else setTotal((t) => Math.max(0, t - 1));
        return;
      }

      // ====== CASO 2: Não aparece em pedidos → HARD DELETE ======
      if (paths.length) {
        const { error: remErr } = await supabase.storage.from("produtos").remove(paths);
        if (remErr) console.warn("Falha ao remover arquivos:", remErr.message);
      }

      await supabase.from("product_images").delete().eq("product_id", productId);
      await supabase.from("product_categories").delete().eq("product_id", productId);

      const { error: delErr } = await supabase.from("products").delete().eq("id", productId);
      if (delErr) throw delErr;

      setRows((prev) => prev.filter((it) => it.product.id !== productId));
      setOk("Produto excluído definitivamente.");
      if (rows.length - 1 === 0 && page > 0) setPage((p) => p - 1);
      else setTotal((t) => Math.max(0, t - 1));
    } catch (e: unknown) {
      const msg = errorMessage(e);
      if (msg.includes("violates foreign key constraint") || msg.includes("foreign key")) {
        setErr(
          "Este produto já foi usado em pedidos. Ele não pode ser apagado; realize o arquivamento (soft delete)."
        );
      } else {
        setErr(msg);
      }
    }
  }

  return (
    <div className="max-w-screen-lg mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold">Lista de Produtos</h1>

        <form onSubmit={onSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome/descrição"
              className="w-64 px-3 py-2 rounded-xl border border-gray-200"
            />
            <Search className="w-4 h-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2" />
          </div>
          <button
            type="submit"
            className="px-3 py-2 rounded-xl text-white"
            style={{ backgroundColor: ACCENT }}
          >
            Buscar
          </button>
        </form>
      </header>

      {err && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {err}
        </div>
      )}

      {warns.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>
            <div className="font-medium">Avisos ao carregar dados auxiliares:</div>
            <ul className="list-disc ml-4">
              {warns.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <label className="text-sm text-gray-700">Ordenar por:</label>
        <select
          value={orderBy}
          onChange={(e) =>
            setOrderBy(
              e.target.value as "created_at" | "title" | "price_cents" | "total_stock" | "active"
            )
          }
          className="px-2 py-1 rounded-lg border border-gray-200 text-sm"
        >
          <option value="created_at">Criação</option>
          <option value="title">Nome</option>
          <option value="price_cents">Preço</option>
          <option value="total_stock">Estoque Total</option>
          <option value="active">Status</option>
        </select>
        <button
          type="button"
          onClick={() => setAscending((v) => !v)}
          className="px-2 py-1 rounded-lg border border-gray-200 text-sm"
          title={ascending ? "Ascendente" : "Descendente"}
        >
          {ascending ? "Asc" : "Desc"}
        </button>
      </div>

      <div className="rounded-2xl border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_140px_140px_120px_120px] gap-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
          <div>Imagem</div>
          <div>Produto</div>
          <div>Preço</div>
          <div>Estoque</div>
          <div>Status</div>
          <div className="text-right pr-1">Ações</div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-sm text-gray-600">Nenhum produto encontrado.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((it) => {
              const p = it.product;
              const totalStock = Number.isFinite(p.total_stock) ? p.total_stock : 0;
              const isOut = totalStock <= 0;
              const isLow = !isOut && totalStock < 10;

              return (
                <li
                  key={p.id}
                  className="grid grid-cols-[80px_1fr_140px_140px_120px_120px] items-center px-3 py-3 gap-2"
                >
                  {/* Imagem */}
                  <div className="w-[64px] h-[64px] rounded-xl bg-gray-100 border border-gray-200 overflow-hidden grid place-items-center">
                    {it.imgUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imgUrl} alt={p.title} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-gray-500" />
                    )}
                  </div>

                  {/* Produto */}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Criado em {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </div>
                  </div>

                  {/* Preço */}
                  <div className="text-sm whitespace-nowrap">
                    {formatBRLFromCents(p.price_cents)}
                  </div>

                  {/* Estoque total (da view) */}
                  <div className="text-sm">
                    {isOut ? (
                      <span className="px-2 py-0.5 rounded-full text-red-700 bg-red-50 border border-red-200 text-xs font-medium">
                        Esgotado
                      </span>
                    ) : (
                      <span
                        className={`tabular-nums ${isLow ? "text-orange-600" : "text-gray-800"}`}
                      >
                        {totalStock}
                      </span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleActive(p.id, !p.active)}
                      className={`w-12 h-6 rounded-full relative transition-colors ${
                        p.active ? "bg-emerald-500" : "bg-gray-300"
                      }`}
                      title={p.active ? "Desativar" : "Ativar"}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                          p.active ? "translate-x-6" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${
                        p.active ? "text-emerald-700" : "text-gray-600"
                      }`}
                    >
                      {p.active ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}{" "}
                      {p.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/dasboard/produtos/editar/${p.id}`}
                      className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white inline-flex items-center gap-1"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Paginação */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-gray-600">
          Página {page + 1} de {totalPages()} — {total} produto(s)
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-2 rounded-xl border border-gray-200 disabled:opacity-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages() - 1, p + 1))}
            disabled={page >= totalPages() - 1}
            className="px-3 py-2 rounded-xl border border-gray-200 disabled:opacity-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {ok && (
        <div className="mt-4 text-sm px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
          {ok}
        </div>
      )}
    </div>
  );
}
