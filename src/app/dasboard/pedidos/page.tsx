"use client";

import React from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  X as XIcon,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Search,
  Plus,
  PackageOpen,
} from "lucide-react";

const ACCENT = "#01A920";
const PAGE_SIZE = 10;

type OrderRow = {
  id: number;
  order_code: string; // '#00001'
  status: "pending" | "approved" | "cancelled";
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  total_cents: number;
  approved_at: string | null;
  created_at: string;
};

type ProductLite = { id: string; title: string };
type RawOrderItemRow = {
  id: number;
  order_id: number;
  quantity: number;
  price_cents: number;
  size_label: string | null;
  variant_option_id: string | null;
  product: ProductLite | ProductLite[] | null;
};

type OrderItemRow = {
  id: number;
  order_id: number;
  quantity: number;
  price_cents: number;
  size_label: string | null;
  variant_option_id: string | null;
  product: ProductLite | null;
};

type ProductPick = {
  id: string;
  title: string;
  price_cents: number;
  amount: number | null; // estoque "base" (produtos sem variação)
};

type VariantGroupRow = { id: string; product_id: string; name: string; position: number };
type VariantOptionRow = { id: string; variant_group_id: string; value: string };
type PVRow = { product_id: string; variant_option_id: string; amount: number };

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

type SizeEntry = { key: SizeKey; optionId: string; amount: number };

function formatBRL(cents: number) {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function OrdersPage() {
  const supabase = supabaseBrowser();

  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<OrderRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);

  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [expanding, setExpanding] = React.useState<Record<number, boolean>>({});
  const [itemsByOrder, setItemsByOrder] = React.useState<Record<number, OrderItemRow[]>>({});

  const [search, setSearch] = React.useState("");

  // --- Estados do "Adicionar item" por pedido ---
  const [productSearchByOrder, setProductSearchByOrder] = React.useState<Record<number, string>>({});
  const [productResultsByOrder, setProductResultsByOrder] = React.useState<Record<number, ProductPick[]>>({});
  const [selectedProductByOrder, setSelectedProductByOrder] = React.useState<Record<number, ProductPick | null>>({});
  const [qtyByOrder, setQtyByOrder] = React.useState<Record<number, number>>({});
  const [addingItemByOrder, setAddingItemByOrder] = React.useState<Record<number, boolean>>({});

  // Variantes por pedido (para o produto SELECIONADO naquele pedido)
  const [sizesByOrder, setSizesByOrder] = React.useState<Record<number, SizeEntry[]>>({});
  const [selectedSizeByOrder, setSelectedSizeByOrder] = React.useState<Record<number, SizeKey | null>>({});

  const totalPages = React.useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const fetchOrders = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let base = supabase
        .from("orders_view")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      if (search.trim()) {
        const q = search.trim();
        const maybeHash = q.startsWith("#") ? q : `#${q}`;
        base = base.or(`order_code.ilike.%${maybeHash}%`);
      }

      const { data, error, count } = await base.range(from, to);
      if (error) throw error;

      setRows((data ?? []) as OrderRow[]);
      setTotal(count || 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao carregar pedidos";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [supabase, page, search]);

  React.useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function loadItems(orderId: number) {
    try {
      setExpanding((m) => ({ ...m, [orderId]: true }));
      const { data, error } = await supabase
        .from("order_items")
        .select(
          "id, order_id, quantity, price_cents, size_label, variant_option_id, product:products(id, title)"
        )
        .eq("order_id", orderId)
        .order("id", { ascending: true });
      if (error) throw error;

      const raw = (data ?? []) as RawOrderItemRow[];

      const normalized: OrderItemRow[] = raw.map((row) => {
        let product: ProductLite | null = null;
        if (Array.isArray(row.product)) {
          product = row.product[0] ?? null;
        } else if (row.product && typeof row.product === "object") {
          product = row.product;
        }
        return {
          id: row.id,
          order_id: row.order_id,
          quantity: row.quantity,
          price_cents: row.price_cents,
          size_label: row.size_label,
          variant_option_id: row.variant_option_id,
          product,
        };
      });

      setItemsByOrder((prev) => ({ ...prev, [orderId]: normalized }));
      // defaults do widget de adicionar
      setQtyByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] ?? 1 }));
      setSelectedProductByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] ?? null }));
      setProductSearchByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] ?? "" }));
      setProductResultsByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] ?? [] }));
      setSizesByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] ?? [] }));
      setSelectedSizeByOrder((prev) => ({ ...prev, [orderId]: prev[orderId] ?? null }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar itens do pedido");
    } finally {
      setExpanding((m) => ({ ...m, [orderId]: false }));
    }
  }

  function toggleExpand(orderId: number) {
    const hasData = !!itemsByOrder[orderId];
    if (hasData) {
      setItemsByOrder((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    } else {
      loadItems(orderId);
    }
  }

  async function approve(orderId: number) {
    setErr(null);
    setOk(null);
    try {
      const { error } = await supabase.rpc("approve_order", { p_order_id: orderId });
      if (error) throw error;
      setOk("Pedido aprovado!");
      setRows((prev) =>
        prev.map((r) =>
          r.id === orderId ? { ...r, status: "approved", approved_at: new Date().toISOString() } : r
        )
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao aprovar pedido");
    }
  }

  async function cancel(orderId: number) {
    setErr(null);
    setOk(null);
    try {
      const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
      if (error) throw error;
      setOk("Pedido cancelado");
      setRows((prev) => prev.map((r) => (r.id === orderId ? { ...r, status: "cancelled" } : r)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao cancelar pedido");
    }
  }

  // Remover item (somente pendente)
  async function removeOrderItem(order: OrderRow, item: OrderItemRow) {
    try {
      if (order.status !== "pending") return;
      setErr(null);
      setOk(null);

      const { error } = await supabase.from("order_items").delete().eq("id", item.id);
      if (error) throw error;

      setItemsByOrder((prev) => {
        const current = prev[order.id] ?? [];
        const nextItems = current.filter((i) => i.id !== item.id);
        return { ...prev, [order.id]: nextItems };
      });

      const delta = item.price_cents * item.quantity;
      setRows((prev) =>
        prev.map((r) => (r.id === order.id ? { ...r, total_cents: Math.max(0, r.total_cents - delta) } : r))
      );

      setOk("Item removido do pedido.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao remover item do pedido");
    }
  }

  // Buscar produtos para adicionar
  async function searchProducts(orderId: number) {
    try {
      const term = (productSearchByOrder[orderId] || "").trim();
      if (!term) {
        setProductResultsByOrder((prev) => ({ ...prev, [orderId]: [] }));
        return;
      }
      const { data, error } = await supabase
        .from("products")
        .select("id, title, price_cents, amount")
        .ilike("title", `%${term}%`)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      setProductResultsByOrder((prev) => ({ ...prev, [orderId]: (data ?? []) as ProductPick[] }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao buscar produtos");
    }
  }

  // Carregar variantes/estoque do produto selecionado (grupo "Tamanho")
  async function loadSizesForSelected(orderId: number, product: ProductPick) {
    try {
      // grupos de tamanho
      const { data: gdata, error: gerr } = await supabase
        .from("variant_groups")
        .select("id, product_id, name, position")
        .eq("product_id", product.id)
        .eq("name", "Tamanho")
        .order("position", { ascending: true });
      if (gerr) throw gerr;

      const groups = (gdata ?? []) as VariantGroupRow[];
      if (!groups.length) {
        setSizesByOrder((prev) => ({ ...prev, [orderId]: [] }));
        setSelectedSizeByOrder((prev) => ({ ...prev, [orderId]: null }));
        return;
      }

      const gid = groups[0].id;

      // opções P/M/G/GG
      const { data: odata, error: oerr } = await supabase
        .from("variant_options")
        .select("id, variant_group_id, value")
        .eq("variant_group_id", gid)
        .in("value", SIZE_LABELS);
      if (oerr) throw oerr;
      const options = (odata ?? []) as VariantOptionRow[];
      const optionIds = options.map((o) => o.id);

      let sizes: SizeEntry[] = [];
      if (optionIds.length) {
        const { data: pv, error: pvErr } = await supabase
          .from("product_variants")
          .select("product_id, variant_option_id, amount")
          .eq("product_id", product.id)
          .in("variant_option_id", optionIds);
        if (pvErr) throw pvErr;

        const stock = (pv ?? []) as PVRow[];

        sizes = SIZE_LABELS.map((label) => {
          const opt = options.find((o) => o.value === label) || null;
          const optionId = opt?.id ?? "";
          const amount =
            stock.find((s) => s.variant_option_id === optionId)?.amount ?? 0;
          return { key: label, optionId, amount };
        }).filter((e) => e.optionId);
      }

      setSizesByOrder((prev) => ({ ...prev, [orderId]: sizes }));

      // pré-seleção: único tamanho com estoque > 0
      const withStock = sizes.filter((s) => s.amount > 0);
      setSelectedSizeByOrder((prev) => ({
        ...prev,
        [orderId]: withStock.length === 1 ? withStock[0].key : null,
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar tamanhos do produto");
      setSizesByOrder((prev) => ({ ...prev, [orderId]: [] }));
      setSelectedSizeByOrder((prev) => ({ ...prev, [orderId]: null }));
    }
  }

  // Adicionar item selecionado ao pedido (somente pendente)
  async function addItemToOrder(order: OrderRow) {
    const selected = selectedProductByOrder[order.id];
    const qty = Math.max(1, qtyByOrder[order.id] ?? 1);
    if (!selected) {
      setErr("Selecione um produto");
      return;
    }
    if (order.status !== "pending") {
      setErr("Apenas pedidos pendentes podem receber itens.");
      return;
    }

    try {
      setErr(null);
      setOk(null);
      setAddingItemByOrder((m) => ({ ...m, [order.id]: true }));

      // Segurança: pega preço atual
      const { data: prod, error: pErr } = await supabase
        .from("products")
        .select("id, title, price_cents, amount")
        .eq("id", selected.id)
        .maybeSingle<ProductPick>();
      if (pErr) throw pErr;
      if (!prod) throw new Error("Produto não encontrado");

      // Verifica se há variantes carregadas para este pedido/produto
      const sizes = sizesByOrder[order.id] ?? [];
      const hasVariants = sizes.length > 0;

      if (hasVariants) {
        // exige seleção de tamanho
        const sel = selectedSizeByOrder[order.id];
        if (!sel) {
          setErr("Selecione um tamanho para adicionar este produto.");
          return;
        }
        const entry = sizes.find((s) => s.key === sel);
        if (!entry) {
          setErr("Tamanho inválido para este produto.");
          return;
        }

        const payload = {
          order_id: order.id,
          product_id: prod.id,
          variant_option_id: entry.optionId,
          size_label: sel,
          quantity: qty,
          price_cents: prod.price_cents,
        };

        const { data: inserted, error: iErr } = await supabase
          .from("order_items")
          .insert(payload)
          .select("id")
          .single<{ id: number }>();
        if (iErr) throw iErr;

        // Atualiza UI
        const newItem: OrderItemRow = {
          id: inserted.id,
          order_id: order.id,
          quantity: qty,
          price_cents: prod.price_cents,
          size_label: sel,
          variant_option_id: entry.optionId,
          product: { id: prod.id, title: prod.title },
        };
        setItemsByOrder((prev) => {
          const current = prev[order.id] ?? [];
          return { ...prev, [order.id]: [...current, newItem] };
        });
      } else {
        // Sem variação
        const payload = {
          order_id: order.id,
          product_id: prod.id,
          quantity: qty,
          price_cents: prod.price_cents,
        };

        const { data: inserted, error: iErr } = await supabase
          .from("order_items")
          .insert(payload)
          .select("id")
          .single<{ id: number }>();
        if (iErr) throw iErr;

        const newItem: OrderItemRow = {
          id: inserted.id,
          order_id: order.id,
          quantity: qty,
          price_cents: prod.price_cents,
          size_label: null,
          variant_option_id: null,
          product: { id: prod.id, title: prod.title },
        };
        setItemsByOrder((prev) => {
          const current = prev[order.id] ?? [];
          return { ...prev, [order.id]: [...current, newItem] };
        });
      }

      // Atualiza total otimista
      const delta = prod.price_cents * qty;
      setRows((prev) =>
        prev.map((r) => (r.id === order.id ? { ...r, total_cents: (r.total_cents || 0) + delta } : r))
      );

      // Reseta quantidade (mantém produto/variantes caso queira adicionar mais)
      setQtyByOrder((prev) => ({ ...prev, [order.id]: 1 }));
      setOk("Item adicionado ao pedido!");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao adicionar item ao pedido");
    } finally {
      setAddingItemByOrder((m) => ({ ...m, [order.id]: false }));
    }
  }

  function StatusBadge({ status }: { status: OrderRow["status"] }) {
    if (status === "approved")
      return (
        <span className="ml-10 px-2 py-0.5 rounded-full text-xs text-emerald-700 bg-emerald-50 border border-emerald-200">
          Aprovado
        </span>
      );
    if (status === "cancelled")
      return (
        <span className="ml-10 px-2 py-0.5 rounded-full text-xs text-gray-700 bg-gray-50 border border-gray-200">
          Cancelado
        </span>
      );
    return (
      <span className="ml-10 px-2 py-0.5 rounded-full text-xs text-amber-700 bg-amber-50 border border-amber-200">
        Pendente
      </span>
    );
  }

  return (
    <div className="max-w-screen-xl mx-auto px-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold">Pedidos</h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            fetchOrders();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por #código"
              className="w-72 px-3 py-2 rounded-xl border border-gray-200"
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
      {ok && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {ok}
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-[120px_1fr_140px_110px_160px] gap-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
          <div>Código</div>
          <div>Total</div>
          <div>Status</div>
          <div>Criado em</div>
          <div className="text-right pr-1">Ações</div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-sm text-gray-600">Nenhum pedido encontrado.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const expanded = !!itemsByOrder[r.id];
              const adding = !!addingItemByOrder[r.id];
              const canMutate = r.status === "pending";
              const results = productResultsByOrder[r.id] ?? [];
              const selected = selectedProductByOrder[r.id] ?? null;
              const qty = Math.max(1, qtyByOrder[r.id] ?? 1);

              const sizes = sizesByOrder[r.id] ?? [];
              const hasVariants = sizes.length > 0;
              const selSize = selectedSizeByOrder[r.id] ?? null;

              // Avisos: para produto sem variação usamos amount base,
              // para produto com variação mostramos o estoque do tamanho selecionado (se houver)
              const baseAmount = selected?.amount ?? null;
              const selectedSizeStock =
                selSize && sizes.find((s) => s.key === selSize)?.amount;

              const outStock =
                hasVariants
                  ? (selectedSizeStock ?? 0) <= 0
                  : (baseAmount ?? 0) <= 0;
              const lowStock =
                hasVariants
                  ? typeof selectedSizeStock === "number" && selectedSizeStock > 0 && selectedSizeStock < 10
                  : typeof baseAmount === "number" && baseAmount > 0 && baseAmount < 10;

              return (
                <li key={r.id} className="px-3 py-3">
                  {/* Linha principal */}
                  <div className="grid grid-cols-[120px_1fr_140px_110px_160px] items-center gap-2">
                    <button
                      onClick={() => toggleExpand(r.id)}
                      className="inline-flex items-center gap-1 text-sm font-medium"
                      title={expanded ? "Recolher" : "Expandir"}
                    >
                      {expanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      )}
                      <span>{r.order_code}</span>
                    </button>

                    <div className="text-sm font-semibold whitespace-nowrap">
                      {formatBRL(r.total_cents)}
                    </div>

                    <div>
                      <StatusBadge status={r.status} />
                    </div>

                    <div className="text-xs text-gray-600">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => approve(r.id)}
                        disabled={r.status !== "pending"}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white disabled:opacity-50 inline-flex items-center gap-1"
                        title="Aprovar"
                      >
                        <Check className="w-4 h-4 text-emerald-600" />
                        Aprovar
                      </button>
                      <button
                        onClick={() => cancel(r.id)}
                        disabled={r.status !== "pending"}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white disabled:opacity-50 inline-flex items-center gap-1"
                        title="Cancelar"
                      >
                        <XIcon className="w-4 h-4 text-gray-600" />
                        Cancelar
                      </button>
                    </div>
                  </div>

                  {/* Itens (expandido) */}
                  {expanded && (
                    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50">
                      {expanding[r.id] ? (
                        <div className="py-6 grid place-items-center">
                          <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                        </div>
                      ) : itemsByOrder[r.id]?.length ? (
                        <div className="p-3">
                          <div className="grid grid-cols-[1fr_120px_120px_120px] gap-2 text-xs font-medium text-gray-600 mb-2">
                            <div>Produto</div>
                            <div className="text-right pr-2">Preço</div>
                            <div className="text-right pr-2">Qtd</div>
                            <div className="text-right pr-2">Subtotal</div>
                          </div>
                          <ul className="divide-y divide-gray-200 bg-white rounded-xl border border-gray-100 overflow-hidden">
                            {itemsByOrder[r.id].map((it) => {
                              const subtotal = it.price_cents * it.quantity;
                              const canRemove = r.status === "pending";
                              return (
                                <li
                                  key={it.id}
                                  className="grid grid-cols-[1fr_120px_120px_120px] gap-2 items-center px-3 py-2 text-sm"
                                >
                                  {/* Produto + botão X */}
                                  <div className="truncate flex items-center gap-2">
                                    <span className="truncate">
                                      {it.product?.title ?? (
                                        <span className="text-gray-500">Produto removido</span>
                                      )}
                                      {it.size_label ? (
                                        <span className="ml-1 text-xs text-gray-500">
                                          • Tam: <b>{it.size_label}</b>
                                        </span>
                                      ) : null}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => removeOrderItem(r, it)}
                                      disabled={!canRemove}
                                      className={`ml-1 inline-flex items-center justify-center rounded-md transition-colors
                                        ${canRemove ? "text-gray-400 hover:text-red-600" : "text-gray-300 cursor-not-allowed"}`}
                                      title={canRemove ? "Remover item" : "Somente pedidos pendentes"}
                                      aria-label="Remover item"
                                    >
                                      <XIcon className="w-4 h-4" />
                                    </button>
                                  </div>

                                  <div className="text-right pr-2">{formatBRL(it.price_cents)}</div>
                                  <div className="text-right pr-2 tabular-nums">{it.quantity}</div>
                                  <div className="text-right pr-2 font-medium">{formatBRL(subtotal)}</div>
                                </li>
                              );
                            })}
                          </ul>

                          {/* ---- Adicionar item (somente pendente) ---- */}
                          <div className="mt-3 p-3 rounded-xl border border-dashed border-gray-300 bg-white">
                            <div className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-2">
                              <PackageOpen className="w-4 h-4" />
                              Adicionar item ao pedido
                            </div>

                            <div className="flex flex-col md:flex-row gap-2 md:items-end">
                              {/* Buscar produto */}
                              <div className="flex-1">
                                <label className="text-xs text-gray-600">Buscar produto</label>
                                <div className="flex gap-2">
                                  <input
                                    value={productSearchByOrder[r.id] || ""}
                                    onChange={(e) =>
                                      setProductSearchByOrder((prev) => ({
                                        ...prev,
                                        [r.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Digite o nome do produto"
                                    className="w-full px-3 py-2 rounded-xl border border-gray-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => searchProducts(r.id)}
                                    className="px-3 py-2 rounded-xl border border-gray-200"
                                    title="Buscar"
                                  >
                                    <Search className="w-4 h-4" />
                                  </button>
                                </div>

                                {/* Resultados */}
                                {results.length > 0 && (
                                  <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-gray-200">
                                    <ul className="divide-y divide-gray-100 bg-white">
                                      {results.map((p) => {
                                        const isSelected = selected?.id === p.id;
                                        return (
                                          <li
                                            key={p.id}
                                            className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between
                                              ${isSelected ? "bg-emerald-50" : "hover:bg-gray-50"}`}
                                            onClick={() => {
                                              setSelectedProductByOrder((prev) => ({ ...prev, [r.id]: p }));
                                              // ao selecionar um produto, carrega suas variantes de tamanho (se houver)
                                              loadSizesForSelected(r.id, p);
                                            }}
                                          >
                                            <span className="truncate">{p.title}</span>
                                            <span className="ml-2 text-xs text-gray-600">
                                              {formatBRL(p.price_cents)}
                                            </span>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                )}
                              </div>

                              {/* Se houver variantes, mostra seletor de tamanho */}
                              {hasVariants && (
                                <div className="w-full md:w-52">
                                  <label className="text-xs text-gray-600">Tamanho</label>
                                  <div className="flex flex-wrap gap-1">
                                    {SIZE_LABELS.map((sz) => {
                                      const entry = sizes.find((s) => s.key === sz);
                                      const exists = Boolean(entry);
                                      const active = selSize === sz;
                                      return (
                                        <button
                                          key={sz}
                                          type="button"
                                          disabled={!exists}
                                          onClick={() =>
                                            setSelectedSizeByOrder((prev) => ({ ...prev, [r.id]: sz }))
                                          }
                                          className={`px-2.5 py-1 rounded-full border text-xs ${
                                            active
                                              ? "text-white border-transparent"
                                              : "text-gray-700 border-gray-200 bg-gray-50"
                                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                                          style={active ? { backgroundColor: ACCENT } : {}}
                                          title={
                                            !exists
                                              ? "Tamanho indisponível"
                                              : `Estoque: ${entry?.amount ?? 0} un.`
                                          }
                                        >
                                          {sz}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Quantidade */}
                              <div className="w-full md:w-40">
                                <label className="text-xs text-gray-600">Quantidade</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={qty}
                                  onChange={(e) =>
                                    setQtyByOrder((prev) => ({
                                      ...prev,
                                      [r.id]: Math.max(1, Number(e.target.value) || 1),
                                    }))
                                  }
                                  className="w-full px-3 py-2 rounded-xl border border-gray-200"
                                />
                              </div>

                              {/* Adicionar */}
                              <div className="w-full md:w-auto">
                                <button
                                  type="button"
                                  onClick={() => addItemToOrder(r)}
                                  disabled={
                                    !canMutate ||
                                    !selected ||
                                    adding ||
                                    (hasVariants && !selSize)
                                  }
                                  className="w-full md:w-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white disabled:opacity-50"
                                  style={{ backgroundColor: ACCENT }}
                                >
                                  {adding ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Plus className="w-4 h-4" />
                                  )}
                                  Adicionar
                                </button>
                                {/* Avisos de estoque (não bloqueiam) */}
                                {selected && outStock && (
                                  <div className="mt-1 text-[11px] text-red-700">
                                    {hasVariants
                                      ? "Tamanho esgotado — ajuste o estoque da variante antes de aprovar."
                                      : "Produto esgotado — ajuste o estoque antes de aprovar."}
                                  </div>
                                )}
                                {selected && lowStock && !outStock && (
                                  <div className="mt-1 text-[11px] text-orange-700">
                                    {hasVariants
                                      ? `Estoque baixo para ${selSize ?? ""} (${selectedSizeStock ?? 0} un.)`
                                      : `Estoque baixo (${selected.amount ?? 0} un.)`}
                                  </div>
                                )}
                              </div>
                            </div>

                            {!canMutate && (
                              <div className="mt-2 text-xs text-gray-600">
                                Itens só podem ser adicionados quando o pedido está <b>pendente</b>.
                              </div>
                            )}
                          </div>

                          <div className="text-right mt-3 text-sm">
                            <span className="text-gray-600">Total do pedido: </span>
                            <span className="font-semibold">{formatBRL(r.total_cents)}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 text-sm text-gray-600 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Nenhum item encontrado para este pedido.
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Paginação */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-gray-600">
          Página {page + 1} de {totalPages} — {total} pedido(s)
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
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-2 rounded-xl border border-gray-200 disabled:opacity-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
