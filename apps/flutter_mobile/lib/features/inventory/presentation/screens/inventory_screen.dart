import 'package:flutter/material.dart';
import '../../../../core/config/app_theme.dart';
import '../../../../core/network/network_info.dart';
import '../../../../shared/widgets/empty_state_view.dart';
import '../../../../shared/widgets/error_view.dart';
import '../../../../shared/widgets/offline_banner.dart';
import '../../models/product.dart';
import '../../services/inventory_repository.dart';
import '../widgets/product_card.dart';
import '../widgets/product_form_dialog.dart';

enum ProductStockFilter { all, inStock, lowStock, outOfStock, expiringSoon }

class InventoryScreen extends StatefulWidget {
  final InventoryRepository? repository;
  final NetworkInfo? networkInfo;

  const InventoryScreen({super.key, this.repository, this.networkInfo});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  late final InventoryRepository _repository;
  late final NetworkInfo _networkInfo;

  List<Product> _allProducts = [];
  bool _isLoading = true;
  String _errorMessage = '';
  bool _isOffline = false;

  String _searchQuery = '';
  String _selectedCategory = 'All';
  ProductStockFilter _stockFilter = ProductStockFilter.all;

  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? InventoryRepository();
    _networkInfo = widget.networkInfo ?? NetworkInfo();
    _loadInitialData();

    _networkInfo.onConnectivityChanged.listen((isOnline) {
      if (mounted) {
        setState(() => _isOffline = !isOnline);
        if (isOnline) _fetchProducts();
      }
    });
  }

  Future<void> _loadInitialData() async {
    final isOnline = await _networkInfo.isConnected;
    if (mounted) setState(() => _isOffline = !isOnline);
    await _fetchProducts();
  }

  Future<void> _fetchProducts() async {
    setState(() {
      _isLoading = true;
      _errorMessage = '';
    });

    try {
      final products = await _repository.getProducts();
      if (mounted) {
        setState(() {
          _allProducts = products;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  List<String> get _categories {
    final set = <String>{'All'};
    for (final p in _allProducts) {
      if (p.category.trim().isNotEmpty) {
        set.add(p.category.trim());
      }
    }
    return set.toList();
  }

  List<Product> get _filteredProducts {
    return _allProducts.where((p) {
      // Search
      if (_searchQuery.isNotEmpty) {
        final q = _searchQuery.toLowerCase();
        final matchName = p.name.toLowerCase().contains(q);
        final matchSku = p.sku.toLowerCase().contains(q);
        if (!matchName && !matchSku) return false;
      }

      // Category
      if (_selectedCategory != 'All' && p.category != _selectedCategory) {
        return false;
      }

      // Stock Filter
      switch (_stockFilter) {
        case ProductStockFilter.lowStock:
          return p.isLowStock;
        case ProductStockFilter.outOfStock:
          return p.isOutOfStock;
        case ProductStockFilter.expiringSoon:
          return p.isExpiringSoon || p.isExpired;
        case ProductStockFilter.inStock:
          return p.isAdequateStock;
        case ProductStockFilter.all:
          return true;
      }
    }).toList();
  }

  Future<void> _onAddProduct() async {
    await showDialog(
      context: context,
      builder: (_) => ProductFormDialog(
        onSave: (newProduct) async {
          final added = await _repository.addProduct(newProduct);
          setState(() {
            _allProducts = [added, ..._allProducts];
          });
        },
      ),
    );
  }

  Future<void> _onEditProduct(Product product) async {
    await showDialog(
      context: context,
      builder: (_) => ProductFormDialog(
        product: product,
        onSave: (updatedProduct) async {
          final updated = await _repository.updateProduct(updatedProduct);
          setState(() {
            _allProducts = _allProducts
                .map((p) => p.id == updated.id ? updated : p)
                .toList();
          });
        },
      ),
    );
  }

  Future<void> _onDeleteProduct(Product product) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Product'),
        content: Text('Are you sure you want to delete "${product.name}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await _repository.deleteProduct(product.id);
      setState(() {
        _allProducts = _allProducts.where((p) => p.id != product.id).toList();
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Deleted ${product.name}')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final lowStockCount = _allProducts.where((p) => p.isLowStock).length;
    final outOfStockCount = _allProducts.where((p) => p.isOutOfStock).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('StockFlow Inventory'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchProducts,
            tooltip: 'Refresh products',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _onAddProduct,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        tooltip: 'Add new product',
        child: const Icon(Icons.add_rounded),
      ),
      body: Column(
        children: [
          OfflineBanner(isOffline: _isOffline),

          // Search Bar
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search products by name or SKU...',
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded, size: 18),
                        onPressed: () => setState(() => _searchQuery = ''),
                      )
                    : null,
              ),
              onChanged: (val) => setState(() => _searchQuery = val.trim()),
            ),
          ),

          // Summary Metrics Banner
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                _buildStatPill(
                  label: 'Total: ${_allProducts.length}',
                  color: AppColors.primary,
                  isDark: isDark,
                ),
                const SizedBox(width: 8),
                _buildStatPill(
                  label: 'Low: $lowStockCount',
                  color: AppColors.warning,
                  isDark: isDark,
                  isSelected: _stockFilter == ProductStockFilter.lowStock,
                  onTap: () => setState(() {
                    _stockFilter = _stockFilter == ProductStockFilter.lowStock
                        ? ProductStockFilter.all
                        : ProductStockFilter.lowStock;
                  }),
                ),
                const SizedBox(width: 8),
                _buildStatPill(
                  label: 'Out: $outOfStockCount',
                  color: AppColors.danger,
                  isDark: isDark,
                  isSelected: _stockFilter == ProductStockFilter.outOfStock,
                  onTap: () => setState(() {
                    _stockFilter = _stockFilter == ProductStockFilter.outOfStock
                        ? ProductStockFilter.all
                        : ProductStockFilter.outOfStock;
                  }),
                ),
              ],
            ),
          ),

          // Category Chips
          if (_categories.length > 1)
            SizedBox(
              height: 44,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                scrollDirection: Axis.horizontal,
                itemCount: _categories.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (ctx, i) {
                  final cat = _categories[i];
                  final isSelected = cat == _selectedCategory;
                  return ChoiceChip(
                    label: Text(cat),
                    selected: isSelected,
                    onSelected: (val) => setState(() => _selectedCategory = cat),
                    selectedColor: AppColors.primary,
                    labelStyle: TextStyle(
                      color: isSelected ? Colors.white : (isDark ? AppColors.darkText : AppColors.lightText),
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                      fontSize: 12,
                    ),
                  );
                },
              ),
            ),

          const SizedBox(height: 4),

          // Main Content
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _errorMessage.isNotEmpty && _allProducts.isEmpty
                    ? ErrorView(
                        message: _errorMessage,
                        onRetry: _fetchProducts,
                      )
                    : _filteredProducts.isEmpty
                        ? EmptyStateView(
                            icon: Icons.inventory_2_outlined,
                            title: _allProducts.isEmpty
                                ? 'No Products Found'
                                : 'No Matching Products',
                            description: _allProducts.isEmpty
                                ? 'Tap the button below to add your first inventory product.'
                                : 'Try clearing your search query or filters.',
                            actionLabel: _allProducts.isEmpty ? 'Add Product' : null,
                            onAction: _allProducts.isEmpty ? _onAddProduct : null,
                          )
                        : RefreshIndicator(
                            onRefresh: _fetchProducts,
                            child: ListView.builder(
                              physics: const AlwaysScrollableScrollPhysics(),
                              padding: const EdgeInsets.only(bottom: 80),
                              itemCount: _filteredProducts.length,
                              itemBuilder: (ctx, idx) {
                                final p = _filteredProducts[idx];
                                return ProductCard(
                                  product: p,
                                  onEdit: () => _onEditProduct(p),
                                  onDelete: () => _onDeleteProduct(p),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatPill({
    required String label,
    required Color color,
    required bool isDark,
    bool isSelected = false,
    VoidCallback? onTap,
  }) {
    final pill = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: isSelected ? color.withOpacity(0.2) : (isDark ? AppColors.darkElement : AppColors.lightElement),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isSelected ? color : Colors.transparent,
          width: 1.5,
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: color,
        ),
      ),
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: pill,
      );
    }
    return pill;
  }
}
