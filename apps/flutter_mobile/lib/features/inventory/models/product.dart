class Product {
  final int id;
  final String name;
  final String sku;
  final String category;
  final String description;
  final double price;
  final int quantity;
  final int reorderLevel;
  final String? expiryDate; // YYYY-MM-DD
  final String? createdAt;
  final String? updatedAt;
  final bool isSynced;

  const Product({
    required this.id,
    required this.name,
    required this.sku,
    this.category = '',
    this.description = '',
    required this.price,
    this.quantity = 0,
    this.reorderLevel = 10,
    this.expiryDate,
    this.createdAt,
    this.updatedAt,
    this.isSynced = true,
  });

  bool get isOutOfStock => quantity <= 0;
  bool get isLowStock => quantity > 0 && quantity <= reorderLevel;
  bool get isAdequateStock => quantity > reorderLevel;

  bool get isExpired {
    if (expiryDate == null || expiryDate!.isEmpty) return false;
    try {
      final exp = DateTime.parse(expiryDate!);
      final today = DateTime.now();
      final todayDate = DateTime(today.year, today.month, today.day);
      return exp.isBefore(todayDate);
    } catch (_) {
      return false;
    }
  }

  bool get isExpiringSoon {
    if (expiryDate == null || expiryDate!.isEmpty) return false;
    try {
      final exp = DateTime.parse(expiryDate!);
      final today = DateTime.now();
      final todayDate = DateTime(today.year, today.month, today.day);
      final diff = exp.difference(todayDate).inDays;
      return diff >= 0 && diff <= 7;
    } catch (_) {
      return false;
    }
  }

  int? get daysUntilExpiry {
    if (expiryDate == null || expiryDate!.isEmpty) return null;
    try {
      final exp = DateTime.parse(expiryDate!);
      final today = DateTime.now();
      final todayDate = DateTime(today.year, today.month, today.day);
      return exp.difference(todayDate).inDays;
    } catch (_) {
      return null;
    }
  }

  Product copyWith({
    int? id,
    String? name,
    String? sku,
    String? category,
    String? description,
    double? price,
    int? quantity,
    int? reorderLevel,
    String? expiryDate,
    String? createdAt,
    String? updatedAt,
    bool? isSynced,
  }) {
    return Product(
      id: id ?? this.id,
      name: name ?? this.name,
      sku: sku ?? this.sku,
      category: category ?? this.category,
      description: description ?? this.description,
      price: price ?? this.price,
      quantity: quantity ?? this.quantity,
      reorderLevel: reorderLevel ?? this.reorderLevel,
      expiryDate: expiryDate ?? this.expiryDate,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isSynced: isSynced ?? this.isSynced,
    );
  }

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] is int ? json['id'] as int : int.tryParse('${json['id']}') ?? 0,
      name: json['name']?.toString() ?? '',
      sku: json['sku']?.toString() ?? '',
      category: json['category']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      price: json['price'] != null
          ? (double.tryParse(json['price'].toString()) ?? 0.0)
          : 0.0,
      quantity: json['quantity'] is int
          ? json['quantity'] as int
          : int.tryParse('${json['quantity']}') ?? 0,
      reorderLevel: json['reorder_level'] is int
          ? json['reorder_level'] as int
          : int.tryParse('${json['reorder_level']}') ?? 10,
      expiryDate: json['expiry_date']?.toString(),
      createdAt: json['created_at']?.toString(),
      updatedAt: json['updated_at']?.toString(),
      isSynced: true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'sku': sku,
      'category': category,
      'description': description,
      'price': price.toStringAsFixed(2),
      'quantity': quantity,
      'reorder_level': reorderLevel,
      'expiry_date': expiryDate,
    };
  }

  Map<String, dynamic> toSqliteMap() {
    return {
      'id': id,
      'name': name,
      'sku': sku,
      'category': category,
      'description': description,
      'price': price,
      'quantity': quantity,
      'reorder_level': reorderLevel,
      'expiry_date': expiryDate,
      'created_at': createdAt,
      'updated_at': updatedAt,
      'is_synced': isSynced ? 1 : 0,
    };
  }

  factory Product.fromSqliteMap(Map<String, dynamic> map) {
    return Product(
      id: map['id'] as int,
      name: map['name'] as String? ?? '',
      sku: map['sku'] as String? ?? '',
      category: map['category'] as String? ?? '',
      description: map['description'] as String? ?? '',
      price: (map['price'] as num?)?.toDouble() ?? 0.0,
      quantity: map['quantity'] as int? ?? 0,
      reorderLevel: map['reorder_level'] as int? ?? 10,
      expiryDate: map['expiry_date'] as String?,
      createdAt: map['created_at'] as String?,
      updatedAt: map['updated_at'] as String?,
      isSynced: (map['is_synced'] as int? ?? 1) == 1,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Product &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          sku == other.sku &&
          quantity == other.quantity &&
          price == other.price;

  @override
  int get hashCode => id.hashCode ^ sku.hashCode ^ quantity.hashCode;
}
