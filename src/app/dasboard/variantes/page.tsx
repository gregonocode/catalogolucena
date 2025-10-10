"use client";

import React from "react";
import { Layers3, Plus, Loader2, Check, X, Pencil, Trash2, GripVertical, Shirt } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

type Product = { id: string; title: string };
type VariantGroup = { id: string; product_id: string; name: string; position: number };
type VariantOption = { id: string; variant_group_id: string; value: string; code: string | null; position: number };

export default function VariantsPage() {
  const supabase = supabaseBrowser();

  const [products, setProducts] = React.useState<Product[]>([]);
  const [productId, setProductId] = React.useState<string>("");
  const [loadingProducts, setLoadingProducts] = React.useState(true);

  const [groups, setGroups] = React.useState<VariantGroup[]>([]);
  const [options, setOptions] = React.useState<VariantOption[]>([]);
  const [loadingData, setLoadingData] = React.useState(false);

  const [groupName, setGroupName] = React.useState("");
  const [creatingGroup, setCreatingGroup] = React.useState(false);

  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  // helper para recarregar grupos+opções do produto atual
  async function reloadFor(pid: string, sb = supabase, setG = setGroups, setO = setOptions, setL = setLoadingData, setE = setErr) {
    if (!pid) { setG([]); setO([]); return; }
    setL(true);
    setE(null);
    const { data: gdata, error: gerr } = await sb
      .from("variant_groups")
      .select("id, product_id, name, position")
      .eq("product_id", pid)
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    if (gerr) { setE(gerr.message); setL(false); return; }

    const groupIds = (gdata ?? []).map(g => g.id);
    let odata: VariantOption[] = [];
    if (groupIds.length) {
      const { data: o, error: oerr } = await sb
        .from("variant_options")
        .select("id, variant_group_id, value, code, position")
        .in("variant_group_id", groupIds)
        .order("position", { ascending: true })
        .order("id", { ascending: true });
      if (oerr) { setE(oerr.message); setL(false); return; }
      odata = (o ?? []) as VariantOption[];
    }
    setG((gdata ?? []) as VariantGroup[]);
    setO(odata);
    setL(false);
  }

  // 1) Carrega produtos (mínimos)
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoadingProducts(true);
      const { data, error } = await supabase
        .from("products")
        .select("id, title")
        .order("created_at", { ascending: false });
      if (!ignore) {
        if (error) {
          console.error(error);
          setErr(error.message);
        } else {
          setProducts(data ?? []);
          const first = (data && data[0]?.id) || "";
          setProductId(first);
          if (first) await reloadFor(first);
        }
        setLoadingProducts(false);
      }
    })();
    return () => { ignore = true; };
  }, [supabase]);

  // 2) Ao trocar produto, recarrega
  React.useEffect(() => {
    if (productId) reloadFor(productId);
    else { setGroups([]); setOptions([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const productGroups = React.useMemo(
    () => groups.filter(g => g.product_id === productId).sort((a,b) => a.position - b.position),
    [groups, productId]
  ); React.useMemo(
    () => groups.filter(g => g.product_id === productId).sort((a,b) => a.position - b.position),
    [groups, productId]
  );

  // Criar grupo
  async function onCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || !productId) return;
    setCreatingGroup(true);
    setErr(null); setOk(null);
    try {
      const nextPos = productGroups.length ? Math.max(...productGroups.map(g => g.position)) + 1 : 0;
      const { data, error } = await supabase
        .from("variant_groups")
        .insert({ product_id: productId, name: groupName.trim(), position: nextPos })
        .select("id, product_id, name, position")
        .single();
      if (error) throw error;
      // Recarrega do banco para refletir ordenação e estado real
      await reloadFor(productId, supabase, setGroups, setOptions, setLoadingData, setErr);
      // setGroups(prev => [...prev, data as VariantGroup]);
      setGroupName("");
      setOk("Grupo criado");
    } catch (e: any) {
      setErr(e?.message || "Erro ao criar grupo");
    } finally {
      setCreatingGroup(false);
    }
  }

  // Editar grupo
  function startEditGroup(id: string) {
    setGroups(prev => prev.map(g => (g.id === id ? ({ ...g, _editing: true } as any) : g)));
  }
  function cancelEditGroup(id: string) {
    setGroups(prev => prev.map(g => (g.id === id ? ({ ...g, _editing: false } as any) : g)));
  }
  async function saveEditGroup(id: string, name: string) {
    try {
      const { data, error } = await supabase
        .from("variant_groups")
        .update({ name: name.trim() })
        .eq("id", id)
        .select("id, product_id, name, position")
        .single();
      if (error) throw error;
      setGroups(prev => prev.map(g => g.id === id ? ({ ...(data as VariantGroup), _editing: false } as any) : g));
    } catch (e: any) {
      setErr(e?.message || "Erro ao salvar grupo");
    }
  }

  // Remover grupo (cascade remove options pelo FK)
  async function removeGroup(id: string) {
    if (!confirm("Remover grupo e suas opções?")) return;
    try {
      const { error } = await supabase.from("variant_groups").delete().eq("id", id);
      if (error) throw error;
      setGroups(prev => prev.filter(g => g.id !== id));
      await reloadFor(productId);
    } catch (e: any) {
      setErr(e?.message || "Erro ao remover grupo");
    }
  }

  // Opções
  async function addOption(groupId: string, value: string, code?: string) {
    if (!value.trim()) return;
    try {
      const count = options.filter(o => o.variant_group_id === groupId).length;
      const { data, error } = await supabase
        .from("variant_options")
        .insert({ variant_group_id: groupId, value: value.trim(), code: (code || null), position: count })
        .select("id, variant_group_id, value, code, position")
        .single();
      if (error) throw error;
      await reloadFor(productId);
    } catch (e: any) {
      setErr(e?.message || "Erro ao adicionar opção");
    }
  }

  async function saveOption(optId: string, payload: Partial<VariantOption>) {
    try {
      const { data, error } = await supabase
        .from("variant_options")
        .update({ value: payload.value?.trim(), code: (payload.code ?? null) })
        .eq("id", optId)
        .select("id, variant_group_id, value, code, position")
        .single();
      if (error) throw error;
      await reloadFor(productId);
    } catch (e: any) {
      setErr(e?.message || "Erro ao salvar opção");
    }
  }

  async function deleteOption(optId: string) {
    if (!confirm("Remover opção?")) return;
    try {
      const { error } = await supabase.from("variant_options").delete().eq("id", optId);
      if (error) throw error;
      await reloadFor(productId);
    } catch (e: any) {
      setErr(e?.message || "Erro ao remover opção");
    }
  }

  return (
    <div className="max-w-screen-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Variantes</h1>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Layers3 className="w-4 h-4" /> grupos (ex.: Cor, Tamanho) e opções
        </span>
      </div>

      {/* Seletor de produto */}
      <div className="mb-4">
        <label className="text-sm text-gray-700">Produto</label>
        <div className="mt-1 relative">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white"
            disabled={loadingProducts}
          >
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
            <Shirt className="w-4 h-4" />
          </span>
        </div>
      </div>

      {/* Criar grupo */}
      <form onSubmit={onCreateGroup} className="space-y-2 mb-6">
        <div className="space-y-1">
          <label className="text-sm text-gray-700">Novo grupo</label>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Ex.: Cor"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
            disabled={!productId}
          />
        </div>
        <button
          type="submit"
          disabled={creatingGroup || !productId}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white shadow-sm active:scale-[0.99]"
          style={{ backgroundColor: ACCENT }}
        >
          {creatingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Criar grupo
        </button>
      </form>

      {/* Lista de grupos com opções */}
      {loadingData ? (
        <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {productGroups.length === 0 ? (
            <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
              Nenhum grupo criado.
            </div>
          ) : null}
          

          {productGroups.map((g) => (
            <section key={g.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center w-7 h-7 rounded-md bg-gray-100 border border-gray-200">
                    <GripVertical className="w-4 h-4 text-gray-600" />
                  </span>
                  {(g as any)._editing ? (
                    <GroupEditInline
                      name={g.name}
                      onCancel={() => cancelEditGroup(g.id)}
                      onSave={(name) => saveEditGroup(g.id, name)}
                    />
                  ) : (
                    <h2 className="text-sm font-medium">{g.name}</h2>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {(g as any)._editing ? null : (
                    <button onClick={() => startEditGroup(g.id)} className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white">
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => removeGroup(g.id)} className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </header>

              {/* Opções do grupo */}
              <OptionsList
                groupId={g.id}
                options={options.filter(o => o.variant_group_id === g.id).sort((a,b) => a.position - b.position)}
                onAdd={addOption}
                onSave={saveOption}
                onDelete={deleteOption}
              />
            </section>
          ))}
        </div>
      )}

      {(ok || err) && (
        <div className="mt-4 text-sm">
          {ok && <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">{ok}</div>}
          {err && <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 mt-2">{err}</div>}
        </div>
      )}
    </div>
  );
}

function GroupEditInline({ name, onCancel, onSave }: { name: string; onCancel: () => void; onSave: (name: string) => void }) {
  const [v, setV] = React.useState(name);
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!v.trim()) return;
    setSaving(true);
    try {
      await onSave(v.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} className="px-2 py-1 rounded-lg border border-gray-200 text-sm" />
      <button onClick={handleSave} className="px-2 py-1 rounded-lg text-white text-xs" style={{ backgroundColor: ACCENT }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
      <button onClick={onCancel} className="px-2 py-1 rounded-lg border border-gray-200 text-xs">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function OptionsList({ groupId, options, onAdd, onSave, onDelete }: {
  groupId: string;
  options: VariantOption[];
  onAdd: (groupId: string, value: string, code?: string) => void;
  onSave: (optId: string, payload: Partial<VariantOption>) => void;
  onDelete: (optId: string) => void;
}) {
  const [value, setValue] = React.useState("");
  const [code, setCode] = React.useState("");

  return (
    <div className="p-3">
      {/* Form inline para criar opção */}
      <div className="flex items-center gap-2 mb-3">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Opção (ex.: Vermelho, P)"
          className="flex-1 px-3 py-2 rounded-xl border border-gray-200"
        />
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código (ex.: red, P)"
          className="w-40 px-3 py-2 rounded-xl border border-gray-200"
        />
        <button
          onClick={() => { onAdd(groupId, value, code); setValue(""); setCode(""); }}
          className="px-3 py-2 rounded-xl text-white text-sm"
          style={{ backgroundColor: ACCENT }}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Lista de opções */}
      <ul className="space-y-2">
        {options.map((o) => (
          <li key={o.id} className="flex items-center justify-between p-2 rounded-xl border border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-md bg-white border border-gray-200">
                <GripVertical className="w-4 h-4 text-gray-600" />
              </span>
              <OptionInline opt={o} onSave={onSave} />
            </div>
            <button onClick={() => onDelete(o.id)} className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white">
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionInline({ opt, onSave }: { opt: VariantOption; onSave: (optId: string, payload: Partial<VariantOption>) => void }) {
  const [v, setV] = React.useState(opt.value);
  const [c, setC] = React.useState(opt.code || "");
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!v.trim()) return;
    setSaving(true);
    try {
      await onSave(opt.id, { value: v.trim(), code: c.trim() || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} className="px-2 py-1 rounded-lg border border-gray-200 text-sm" />
      <input value={c} onChange={(e) => setC(e.target.value)} className="w-28 px-2 py-1 rounded-lg border border-gray-200 text-sm" />
      <button onClick={handleSave} className="px-2 py-1 rounded-lg text-white text-xs" style={{ backgroundColor: ACCENT }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
    </div>
  );
}
