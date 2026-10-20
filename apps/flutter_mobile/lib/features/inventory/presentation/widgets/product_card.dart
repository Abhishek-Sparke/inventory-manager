import 'package:flutter/material.dart';
import '../../../../core/config/app_theme.dart';
import '../../models/product.dart';
import 'stock_status_badge.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const ProductCard({
    super.key,
    required this.product,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        product.name,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: isDark ? AppColors.darkText : AppColors.lightText,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'SKU: ${product.sku}${product.category.isNotEmpty ? ' · ${product.category}' : ''}',
                        style: TextStyle(
                          fontSize: 13,
                          color: isDark
                              ? AppColors.darkTextSecondary
                              : AppColors.lightTextSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                StockStatusBadge(product: product),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.darkElement : AppColors.lightElement,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.inventory_2_outlined,
                        size: 16,
                        color: product.isOutOfStock
                            ? AppColors.danger
                            : product.isLowStock
                                ? AppColors.warning
                                : AppColors.primary,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Qty: ${product.quantity}',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                          color: product.isOutOfStock
                              ? AppColors.danger
                              : isDark
                                  ? AppColors.darkText
                                  : AppColors.lightText,
                        ),
                      ),
                      Text(
                        ' / ${product.reorderLevel}',
                        style: TextStyle(
                          fontSize: 11,
                          color: isDark
                              ? AppColors.darkTextSecondary
                              : AppColors.lightTextSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '\$${product.price.toStringAsFixed(2)}',
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.edit_outlined, size: 20),
                  onPressed: onEdit,
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Edit product',
                  color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline_rounded, size: 20),
                  onPressed: onDelete,
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Delete product',
                  color: AppColors.danger,
                ),
              ],
            ),
            if (product.expiryDate != null && product.expiryDate!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    Icons.event_outlined,
                    size: 14,
                    color: product.isExpired
                        ? AppColors.danger
                        : product.isExpiringSoon
                            ? AppColors.warning
                            : (isDark
                                ? AppColors.darkTextSecondary
                                : AppColors.lightTextSecondary),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Expires: ${product.expiryDate}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: product.isExpired || product.isExpiringSoon
                          ? FontWeight.w600
                          : FontWeight.normal,
                      color: product.isExpired
                          ? AppColors.danger
                          : product.isExpiringSoon
                              ? AppColors.warning
                              : (isDark
                                  ? AppColors.darkTextSecondary
                                  : AppColors.lightTextSecondary),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
