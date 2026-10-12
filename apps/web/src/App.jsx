
import { useEffect, useState } from 'react'
import './App.css'

const API_URL = 'http://127.0.0.1:8000/api/products/'

function App() {
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)

  const [form, setForm] = useState({
    name: '',
    sku: '',
    category: 'General',
    description: '',
    price: '',
    quantity: '0',
    reorder_level: '10',
    expiry_date: '',
  })

  async function loadProducts() {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(API_URL)
      if (!response.ok) throw new Error(`Server returned ${response.status}`)

      const data = await response.json()
      setProducts(Array.isArray(data) ? data : data.results ?? [])
    } catch (err) {
      setError('Could not load products. Check that Django is running.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProducts()
  }, [])

  const lowStock = products.filter(
    product => product.quantity <= product.reorder_level
  ).length

  const filteredProducts = products.filter(product =>
    `${product.name} ${product.sku} ${product.category}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )

  const totalUnits = products.reduce(
    (sum, product) => sum + Number(product.quantity),
    0
  )

  const categories = new Set(products.map(product => product.category))

  function updateForm(event) {
    setForm({ ...form, [event.target.name]: event.target.value })
  }

  async function addProduct(event) {
    event.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      ...form,
      price: form.price,
      quantity: Number(form.quantity),
      reorder_level: Number(form.reorder_level),
      expiry_date: form.expiry_date || null,
    }

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        const message = Object.entries(data)
          .map(([field, errors]) =>
            `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`
          )
          .join('\n')
        throw new Error(message || 'Could not create product.')
      }

      setProducts(previous => [...previous, data])
      setForm({
        name: '',
        sku: '',
        category: 'General',
        description: '',
        price: '',
        quantity: '0',
        reorder_level: '10',
        expiry_date: '',
      })
      setShowForm(false)
    } catch (err) {
      setError(err.message || 'Could not save product. Check Django and MySQL.')
    } finally {
      setSaving(false)
    }
  }

function startEditing(product) {
  setEditingProduct({
    ...product,
    price: String(product.price ?? ''),
    quantity: String(product.quantity ?? 0),
    reorder_level: String(product.reorder_level ?? 10),
    expiry_date: product.expiry_date ?? '',
  })
  setShowForm(false)
  setError('')
}

function updateEditingForm(event) {
  setEditingProduct(previous => ({
    ...previous,
    [event.target.name]: event.target.value,
  }))
}

async function saveEditedProduct(event) {
  event.preventDefault()
  if (!editingProduct) return

  setSaving(true)
  setError('')

  const payload = {
    ...editingProduct,
    price: editingProduct.price,
    quantity: Number(editingProduct.quantity),
    reorder_level: Number(editingProduct.reorder_level),
    expiry_date: editingProduct.expiry_date || null,
  }

  try {
    const response = await fetch(`${API_URL}${editingProduct.id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      const message = Object.entries(data)
        .map(([field, errors]) =>
          `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`
        )
        .join('\n')
      throw new Error(message || 'Could not update product.')
    }

    setProducts(previous =>
      previous.map(product => product.id === data.id ? data : product)
    )
    setEditingProduct(null)
  } catch (err) {
    setError(err.message || 'Could not update product.')
  } finally {
    setSaving(false)
  }
}

async function deleteProduct(product) {
  const confirmed = window.confirm(
    `Delete "${product.name}" (${product.sku})? This cannot be undone.`
  )

  if (!confirmed) return

  setError('')

  try {
    const response = await fetch(`${API_URL}${product.id}/`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Could not delete product. Server returned ${response.status}.`)
    }

    setProducts(previous =>
      previous.filter(item => item.id !== product.id)
    )

    if (editingProduct?.id === product.id) {
      setEditingProduct(null)
    }
  } catch (err) {
    setError(err.message || 'Could not delete product.')
  }
}


  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon">S</span> StockFlow</div>
        <p className="nav-label">WORKSPACE</p>
        <a className="nav-item active" href="#dashboard">▦ <span>Dashboard</span></a>
        <a className="nav-item" href="#inventory">▤ <span>Inventory</span></a>
        <a className="nav-item" href="#alerts">♧ <span>Notifications</span>{lowStock > 0 && <span className="nav-count">{lowStock}</span>}</a>
        <div className="sidebar-bottom">
          <div className="avatar">A</div>
          <div><strong>Administrator</strong><small>Inventory Manager</small></div>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div>
            <h1>Inventory Dashboard</h1>
            <p>Monitor your stock and manage products.</p>
          </div>
          <span className="online-status"><span /> Local workspace</span>
        </header>

        {error && (
          <div role="alert" className="error-message">
            <p>{error}</p>
            <button onClick={loadProducts} disabled={loading}>Retry loading</button>
          </div>
        )}

        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-icon blue">▤</span>
            <p>Total Products</p><h2>{products.length}</h2><small>Products registered</small>
          </article>
          <article className="stat-card">
            <span className="stat-icon green">▣</span>
            <p>Total Units</p><h2>{totalUnits}</h2><small>Units currently available</small>
          </article>
          <article className="stat-card">
            <span className="stat-icon orange">⚠</span>
            <p>Low Stock</p><h2>{lowStock}</h2><small>At or below reorder level</small>
          </article>
          <article className="stat-card">
            <span className="stat-icon purple">♧</span>
            <p>Categories</p><h2>{categories.size}</h2><small>Unique categories</small>
          </article>
        </section>

        <section className="inventory-panel" id="inventory">
          <div className="panel-heading">
            <div><h2>Product Inventory</h2><p>View and manage your products</p></div>
            <button className="add-button" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancel' : '+ Add Product'}
            </button>
          </div>

          {showForm && (
            <form className="product-form" onSubmit={addProduct}>
              <label>Product name
                <input name="name" value={form.name} onChange={updateForm} required maxLength={150} />
              </label>
              <label>SKU
                <input name="sku" value={form.sku} onChange={updateForm} required maxLength={50} />
              </label>
              <label>Category
                <input name="category" value={form.category} onChange={updateForm} maxLength={100} />
              </label>
              <label>Description
                <input name="description" value={form.description} onChange={updateForm} />
              </label>
              <label>Price
                <input name="price" type="number" min="0" step="0.01" value={form.price} onChange={updateForm} required />
              </label>
              <label>Quantity
                <input name="quantity" type="number" min="0" step="1" value={form.quantity} onChange={updateForm} required />
              </label>
              <label>Reorder level
                <input name="reorder_level" type="number" min="0" step="1" value={form.reorder_level} onChange={updateForm} required />
              </label>
              <label>Expiry date (optional)
                <input name="expiry_date" type="date" value={form.expiry_date} onChange={updateForm} />
              </label>
              <button className="add-button" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Product'}
              </button>
            </form>
          )}

{editingProduct && (
  <form className="product-form" onSubmit={saveEditedProduct}>
    <h3 className="form-title">Edit Product: {editingProduct.name}</h3>

    <label>Product name
      <input name="name" value={editingProduct.name} onChange={updateEditingForm} required maxLength={150} />
    </label>

    <label>SKU
      <input name="sku" value={editingProduct.sku} onChange={updateEditingForm} required maxLength={50} />
    </label>

    <label>Category
      <input name="category" value={editingProduct.category ?? ''} onChange={updateEditingForm} maxLength={100} />
    </label>

    <label>Description
      <input name="description" value={editingProduct.description ?? ''} onChange={updateEditingForm} />
    </label>

    <label>Price
      <input name="price" type="number" min="0" step="0.01" value={editingProduct.price} onChange={updateEditingForm} required />
    </label>

    <label>Quantity
      <input name="quantity" type="number" min="0" step="1" value={editingProduct.quantity} onChange={updateEditingForm} required />
    </label>

    <label>Reorder level
      <input name="reorder_level" type="number" min="0" step="1" value={editingProduct.reorder_level} onChange={updateEditingForm} required />
    </label>

    <label>Expiry date
      <input name="expiry_date" type="date" value={editingProduct.expiry_date} onChange={updateEditingForm} />
    </label>

    <div className="form-actions">
      <button className="add-button" type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
      <button type="button" className="cancel-button" onClick={() => setEditingProduct(null)}>
        Cancel
      </button>
    </div>
  </form>
)}


          <div className="table-toolbar">
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search products, SKU or category..."
              aria-label="Search inventory"
            />
            <span>{filteredProducts.length} products</span>
          </div>

          {loading ? <p>Loading products...</p> : (
            <div className="table-wrapper">
              <table>
              <thead>
                <tr>
                  <th>PRODUCT</th>
                  <th>SKU</th>
                  <th>CATEGORY</th>
                  <th>QUANTITY</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
                <tbody>
                  {filteredProducts.map(product => {
                    const isLow = Number(product.quantity) <= Number(product.reorder_level)
                    return (
                      <tr key={product.id}>
                        <td><strong>{product.name}</strong></td>
                        <td>{product.sku}</td>
                        <td>{product.category || '—'}</td>
                        <td>{product.quantity} units</td>
                        <td>
                          <span className={`status ${isLow ? 'low' : 'stock'}`}>
                            {isLow ? 'Low Stock' : 'In Stock'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="edit-button"
                              onClick={() => startEditing(product)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="delete-button"
                              onClick={() => deleteProduct(product)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredProducts.length === 0 && (
                    <tr><td colSpan="6" className="empty-state">No matching products found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="alerts-panel" id="alerts">
          <div><h2>Stock Alerts</h2><p>Products at or below their reorder level</p></div>
          {products.filter(product => Number(product.quantity) <= Number(product.reorder_level)).map(product => (
            <div className="alert-row" key={product.id}>
              <span className="alert-symbol">!</span>
              <div><strong>{product.name}</strong><small>{product.sku}</small></div>
              <span className="alert-quantity">{product.quantity} units left</span>
            </div>
          ))}
          {lowStock === 0 && <p className="empty-state">All products have sufficient stock.</p>}
        </section>

        <footer>StockFlow Inventory Management · Local development</footer>
      </main>
    </div>
  )
}

export default App
