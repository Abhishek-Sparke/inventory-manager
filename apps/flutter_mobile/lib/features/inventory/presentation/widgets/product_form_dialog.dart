import 'package:flutter/material.dart';
import '../../models/product.dart';

class ProductFormDialog extends StatefulWidget {
  final Product? product; // null for add, non-null for edit
  final Future<void> Function(Product product) onSave;

  const ProductFormDialog({super.key, this.product, required this.onSave});

  @override
  State<ProductFormDialog> createState() => _ProductFormDialogState();
}

class _ProductFormDialogState extends State<ProductFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameController;
  late TextEditingController _skuController;
  late TextEditingController _categoryController;
  late TextEditingController _priceController;
  late TextEditingController _quantityController;
  late TextEditingController _reorderController;
  late TextEditingController _expiryController;
  late TextEditingController _descController;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    final p = widget.product;
    _nameController = TextEditingController(text: p?.name ?? '');
    _skuController = TextEditingController(text: p?.sku ?? '');
    _categoryController = TextEditingController(text: p?.category ?? '');
    _priceController = TextEditingController(
        text: p != null ? p.price.toStringAsFixed(2) : '');
    _quantityController =
        TextEditingController(text: p != null ? '${p.quantity}' : '0');
    _reorderController =
        TextEditingController(text: p != null ? '${p.reorderLevel}' : '10');
    _expiryController = TextEditingController(text: p?.expiryDate ?? '');
    _descController = TextEditingController(text: p?.description ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _skuController.dispose();
    _categoryController.dispose();
    _priceController.dispose();
    _quantityController.dispose();
    _reorderController.dispose();
    _expiryController.dispose();
    _descController.dispose();
    super.dispose();
  }

  Future<void> _pickExpiryDate() async {
    DateTime initial = DateTime.now().add(const Duration(days: 30));
    if (_expiryController.text.isNotEmpty) {
      try {
        initial = DateTime.parse(_expiryController.text);
      } catch (_) {}
    }

    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2040),
    );

    if (picked != null) {
      final y = picked.year;
      final m = picked.month.toString().padLeft(2, '0');
      final d = picked.day.toString().padLeft(2, '0');
      setState(() {
        _expiryController.text = '$y-$m-$d';
      });
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);
    try {
      final price = double.tryParse(_priceController.text.trim()) ?? 0.0;
      final quantity = int.tryParse(_quantityController.text.trim()) ?? 0;
      final reorderLevel = int.tryParse(_reorderController.text.trim()) ?? 10;
      final expiry = _expiryController.text.trim().isNotEmpty
          ? _expiryController.text.trim()
          : null;

      final updated = Product(
        id: widget.product?.id ?? 0,
        name: _nameController.text.trim(),
        sku: _skuController.text.trim(),
        category: _categoryController.text.trim(),
        price: price,
        quantity: quantity,
        reorderLevel: reorderLevel,
        expiryDate: expiry,
        description: _descController.text.trim(),
        isSynced: widget.product?.isSynced ?? false,
      );

      await widget.onSave(updated);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error saving product: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.product != null;

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500, maxHeight: 650),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      isEdit ? 'Edit Product' : 'Add Product',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).pop(),
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
                const Divider(),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        TextFormField(
                          controller: _nameController,
                          decoration: const InputDecoration(labelText: 'Product Name *'),
                          validator: (v) =>
                              (v == null || v.trim().isEmpty) ? 'Name is required' : null,
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _skuController,
                                decoration: const InputDecoration(labelText: 'SKU *'),
                                validator: (v) => (v == null || v.trim().isEmpty)
                                    ? 'SKU is required'
                                    : null,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _categoryController,
                                decoration: const InputDecoration(labelText: 'Category'),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _priceController,
                                decoration: const InputDecoration(
                                  labelText: 'Price (\$) *',
                                  prefixText: '\$ ',
                                ),
                                keyboardType: const TextInputType.numberWithOptions(
                                    decimal: true),
                                validator: (v) {
                                  if (v == null || v.trim().isEmpty) {
                                    return 'Price required';
                                  }
                                  if (double.tryParse(v.trim()) == null) {
                                    return 'Invalid number';
                                  }
                                  return null;
                                },
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _quantityController,
                                decoration: const InputDecoration(labelText: 'Quantity *'),
                                keyboardType: TextInputType.number,
                                validator: (v) => (int.tryParse(v ?? '') == null)
                                    ? 'Invalid integer'
                                    : null,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _reorderController,
                                decoration: const InputDecoration(
                                    labelText: 'Reorder Level *'),
                                keyboardType: TextInputType.number,
                                validator: (v) => (int.tryParse(v ?? '') == null)
                                    ? 'Invalid integer'
                                    : null,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _expiryController,
                                readOnly: true,
                                onTap: _pickExpiryDate,
                                decoration: InputDecoration(
                                  labelText: 'Expiry Date',
                                  hintText: 'YYYY-MM-DD',
                                  suffixIcon: IconButton(
                                    icon: const Icon(Icons.calendar_today_outlined,
                                        size: 18),
                                    onPressed: _pickExpiryDate,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _descController,
                          maxLines: 2,
                          decoration: const InputDecoration(
                            labelText: 'Description',
                            hintText: 'Optional product notes or specifications',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
                    const SizedBox(width: 12),
                    ElevatedButton(
                      onPressed: _isSaving ? null : _submit,
                      child: _isSaving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(isEdit ? 'Save Changes' : 'Add Product'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
