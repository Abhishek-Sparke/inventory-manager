import 'package:flutter/material.dart';
import '../../models/product.dart';

class StockStatusBadge extends StatelessWidget {
  final Product product;

  const StockStatusBadge({super.key, required this.product});

  @override
  Widget build(BuildContext context) {
    String label;
    Color bg;
    Color text;

    if (!product.isSynced) {
      label = 'Offline draft';
      bg = const Color(0xFFE0E7FF);
      text = const Color(0xFF3730A3);
    } else if (product.isOutOfStock) {
      label = 'Out of Stock';
      bg = const Color(0xFFFEE2E2);
      text = const Color(0xFF991B1B);
    } else if (product.isExpired) {
      label = 'Expired';
      bg = const Color(0xFFFFE4E6);
      text = const Color(0xFFBE123C);
    } else if (product.isExpiringSoon) {
      label = 'Expiring in ${product.daysUntilExpiry}d';
      bg = const Color(0xFFFEF3C7);
      text = const Color(0xFF92400E);
    } else if (product.isLowStock) {
      label = 'Low Stock';
      bg = const Color(0xFFFEF3C7);
      text = const Color(0xFF92400E);
    } else {
      label = 'In Stock';
      bg = const Color(0xFFD1FAE5);
      text = const Color(0xFF065F46);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: text,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.2,
        ),
      ),
    );
  }
}
